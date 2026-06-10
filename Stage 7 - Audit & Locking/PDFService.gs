/**
 * HGUS Academic Result Management System
 * PDFService.gs — PDF generation for result slips (Stage 5 base / Stage 7 updates)
 *
 * STAGE 7 CHANGES:
 *   - buildSlipHtml_: uses student.slipName (SURNAME Firstname format) for the
 *     Name field on the PDF instead of student.name (first-last order).
 *   - assembleStudentResult_: accepts a new slipName parameter; includes it in
 *     result.student so buildSlipHtml_ can access it.
 *   - loadGroupData_: builds slipName for each student from lastName +
 *     firstMiddleName stored in the Students Cache (added in Stage 7).
 *   - generateResultSlipPDF: reads lastName/firstMiddleName from the student
 *     cache row and builds slipName before calling assembleStudentResult_.
 *   - generateBulkResultsPDF: passes studentObj.slipName to assembleStudentResult_.
 *
 * Generates result slip PDFs for individual students or all active students
 * in a class group in one combined document.
 *
 * ─── HOW GAS PDF GENERATION WORKS ───────────────────────────────────────────
 *
 *   Google Apps Script converts HTML → PDF via:
 *     Utilities.newBlob(htmlString, 'text/html').getAs('application/pdf')
 *
 *   CRITICAL CONSTRAINT: The GAS PDF renderer does NOT process:
 *     - CSS variables (--my-color: red)
 *     - External stylesheets
 *     - Google Fonts @import
 *   ALL styles must be written as inline style="..." attributes.
 *   All colors, sizes, and spacing must be plain CSS literals (e.g. #003366, 12pt).
 *
 *   The base64-encoded bytes of the resulting PDF blob are returned to the client.
 *   The client converts them to a data URL and triggers a browser download
 *   using a hidden <a download> element.
 *
 * ─── WHAT IS GENERATED ──────────────────────────────────────────────────────
 *
 *   Single slip:  One student's result slip — all subjects, PSQ, remark, summary.
 *   Bulk PDF:     One page per active student, all concatenated in a single PDF
 *                 (page-break-after: always between each student's section).
 *
 * ─── ACCESS ─────────────────────────────────────────────────────────────────
 *
 *   Admin / Super Admin: any student / class group.
 *   Form Master:         only students in their assigned class.
 *
 * ─── LOCK ENFORCEMENT ───────────────────────────────────────────────────────
 *
 *   PDF generation is only permitted when resultsUnlocked = true.
 *   The check is done in Code.gs (the server endpoint) before calling this
 *   service — so PDFService itself can assume data is complete.
 *   (This keeps the service focused on rendering, not policy.)
 *
 * PUBLIC FUNCTIONS:
 *   - generateResultSlipPDF(token, studentId, classId)
 *       Returns base64-encoded PDF for one student.
 *
 *   - generateBulkResultsPDF(token, classGroupKey)
 *       Returns base64-encoded PDF for all active students in the group.
 */

const PDFService = (function () {

  // ─── PRIVATE: RESULT DATA ASSEMBLY ──────────────────────────────────────────

  /**
   * Mirrors getGroupKey_() in BroadsheetService / ResultService / CompletionService.
   * Strips the SSS department suffix so all departments at the same level share one key.
   */
  function getGroupKey_(className) {
    return String(className)
      .replace(/\s+(science|art|commerce|humanities|business)\s*$/i, '')
      .trim();
  }

  /**
   * Compute the total score from a map of component scores.
   * Returns null if NO component has been entered yet.
   *
   * @param {{ [component]: number|string }} scoresMap
   * @returns {number|null}
   */
  function computeTotal_(scoresMap) {
    var hasAny = false;
    var total  = 0;
    COMPONENT_ORDER.forEach(function (key) {
      var val = scoresMap[key];
      if (val !== undefined && val !== null && val !== '') {
        hasAny = true;
        total += Number(val) || 0;
      }
    });
    return hasAny ? total : null;
  }

  /**
   * Rank an array of { studentId, total } by total descending.
   * Ties share a rank; the next rank after a tie block is skipped.
   *
   * @param {{ studentId: string, total: number }[]} arr
   * @returns {{ [studentId]: number }} position map
   */
  function rankByTotal_(arr) {
    var sorted = arr.slice().sort(function (a, b) { return b.total - a.total; });
    var posMap = {};
    sorted.forEach(function (s, idx) {
      if (idx === 0) {
        posMap[s.studentId] = 1;
      } else {
        var prev = sorted[idx - 1];
        posMap[s.studentId] = (s.total === prev.total)
          ? posMap[prev.studentId]
          : idx + 1;
      }
    });
    return posMap;
  }

  /**
   * Assemble the full result data for one student.
   * Replicates the logic of ResultService.getStudentResult() but takes
   * pre-loaded bulk data (groupScores, groupPSQ, groupRemarks, allGroupStudents,
   * activeGroupStudents, subjectIds, allStatuses) so the caller can reuse a
   * single bulk read across many students in the bulk PDF case.
   *
   * @param {string}   studentId
   * @param {string}   classId
   * @param {string}   className
   * @param {string}   activeTerm
   * @param {string}   activeSession
   * @param {Object}   settings         — from SheetService.getSessionSettings()
   * @param {Object}   scoreLookup      — "studentId|subjectId|component" → score
   * @param {Object[]} allGroupStudents — all students in the group (for ranking)
   * @param {string[]} activeGroupIds   — active student IDs (for ranking)
   * @param {string[]} subjectIds       — deduplicated subject IDs for the group
   * @param {Object}   subjectById      — subjectId → subject object
   * @param {Object}   statusMap        — studentId → termStatus for all group students
   * @param {Object}   psqLookup        — studentId → PSQ row object (or null)
   * @param {Object}   remarkLookup     — studentId → remark string (or '')
   * @param {string}   formMasterName
   * @returns {Object} assembled result data object (same shape as ResultService output)
   */
  function assembleStudentResult_(
    studentId, classId, className,
    activeTerm, activeSession, settings,
    scoreLookup,
    allGroupStudents, activeGroupIds, subjectIds, subjectById,
    statusMap, psqLookup, remarkLookup,
    formMasterName, studentName, slipName   // slipName added Stage 7: SURNAME Firstname format
  ) {
    var termStatus = statusMap[studentId] || STUDENT_STATUS.ACTIVE;
    var isActive   = (termStatus === STUDENT_STATUS.ACTIVE);

    // Build active group students array (for ranking)
    var activeGroupStudents = allGroupStudents.filter(function (gs) {
      return activeGroupIds.indexOf(gs.studentId) !== -1;
    });

    // ── Per-subject results ────────────────────────────────────────────────
    var subjectResults = subjectIds.map(function (subjectId) {
      var subj = subjectById[subjectId] || {};

      // Build this student's component scores for this subject
      var thisStudentScores = {};
      COMPONENT_ORDER.forEach(function (key) {
        var val = scoreLookup[studentId + '|' + subjectId + '|' + key];
        thisStudentScores[key] = (val !== undefined && val !== null && val !== '') ? val : '';
      });

      var total        = isActive ? computeTotal_(thisStudentScores) : null;
      var grade        = null;
      var gradeComment = null;
      if (total !== null) {
        var g    = getGrade(total);
        grade        = g.grade;
        gradeComment = g.comment;
      }

      // Compute position for this subject across all active students in the group
      var forRanking = activeGroupStudents.map(function (gs) {
        var gsScores = {};
        COMPONENT_ORDER.forEach(function (key) {
          var val = scoreLookup[gs.studentId + '|' + subjectId + '|' + key];
          gsScores[key] = (val !== undefined && val !== null && val !== '') ? val : '';
        });
        return { studentId: gs.studentId, total: computeTotal_(gsScores) };
      }).filter(function (gs) { return gs.total !== null; });

      var posMap   = rankByTotal_(forRanking);
      var position = isActive ? (posMap[studentId] || null) : null;

      var allTotals = forRanking.map(function (gs) { return gs.total; });
      var classMax  = allTotals.length > 0 ? Math.max.apply(null, allTotals) : null;

      return {
        subjectId:    subjectId,
        subjectName:  subj.subjectName || subjectId,
        scores:       thisStudentScores,
        total:        total,
        grade:        grade,
        gradeComment: gradeComment,
        position:     position,
        classMax:     classMax
      };
    });

    // Sort alphabetically by subject name
    subjectResults.sort(function (a, b) {
      return a.subjectName.localeCompare(b.subjectName);
    });

    // ── Overall position ───────────────────────────────────────────────────
    var studentOverallTotals = activeGroupStudents.map(function (gs) {
      var sumOfTotals  = 0;
      var hasAnySubject = false;
      subjectIds.forEach(function (sid) {
        var gsScores = {};
        COMPONENT_ORDER.forEach(function (key) {
          var val = scoreLookup[gs.studentId + '|' + sid + '|' + key];
          gsScores[key] = (val !== undefined && val !== null && val !== '') ? val : '';
        });
        var t = computeTotal_(gsScores);
        if (t !== null) { sumOfTotals += t; hasAnySubject = true; }
      });
      return { studentId: gs.studentId, total: hasAnySubject ? sumOfTotals : null };
    }).filter(function (gs) { return gs.total !== null; });

    var overallPosMap   = rankByTotal_(studentOverallTotals);
    var overallPosition = isActive ? (overallPosMap[studentId] || null) : null;

    // ── Summary stats ──────────────────────────────────────────────────────
    var validSubjects = subjectResults.filter(function (s) { return s.total !== null; });
    var totalScore    = validSubjects.reduce(function (sum, s) { return sum + s.total; }, 0);
    var averageScore  = validSubjects.length > 0
      ? Math.round((totalScore / validSubjects.length) * 10) / 10
      : 0;
    var overallGrade  = validSubjects.length > 0 ? getGrade(averageScore).grade : null;

    // ── PSQ data ──────────────────────────────────────────────────────────
    var psqRow  = psqLookup[studentId] || null;
    var psqData = {};
    if (psqRow) {
      PSQ_TRAITS.forEach(function (trait) {
        var key = toCamelCase(trait);
        psqData[key] = (psqRow[key] !== undefined && psqRow[key] !== '') ? psqRow[key] : null;
      });
    }

    return {
      student: {
        studentId:  studentId,
        name:       studentName,
        // slipName: SURNAME Firstname format (e.g. "TESTSON Alpha") used on PDF name line.
        // Falls back to studentName if slipName was not provided (cache not yet refreshed).
        slipName:   slipName || studentName,
        classId:    classId,
        className:  className,
        termStatus: termStatus
      },
      session:             activeSession,
      term:                activeTerm,
      termStartDate:       settings.termStartDate    || '',
      termEndDate:         settings.termEndDate      || '',
      nextTermFee:         settings.nextTermFee      || '',
      nextTermResumption:  settings.nextTermResumption || '',
      subjects:            subjectResults,
      summary: {
        totalScore:      totalScore,
        averageScore:    averageScore,
        overallGrade:    overallGrade,
        overallPosition: overallPosition,
        classSize:       activeGroupStudents.length,
        subjectCount:    validSubjects.length
      },
      psq:            psqData,
      remark:         remarkLookup[studentId] || '',
      formMasterName: formMasterName
    };
  }

  // ─── PRIVATE: ORDINAL SUFFIX ────────────────────────────────────────────────

  /**
   * Convert a number to ordinal string: 1 → "1st", 2 → "2nd", 11 → "11th", etc.
   * @param {number|null} n
   * @returns {string}
   */
  function toOrdinal_(n) {
    if (n === null || n === undefined) return '—';
    var s = String(n);
    var mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return s + 'th';
    switch (n % 10) {
      case 1: return s + 'st';
      case 2: return s + 'nd';
      case 3: return s + 'rd';
      default: return s + 'th';
    }
  }

  /**
   * Convert a PSQ numeric rating to a label string.
   * @param {number|null} rating
   * @returns {string}
   */
  function psqLabel_(rating) {
    var map = { 5: 'Excellent', 4: 'Very Good', 3: 'Good', 2: 'Fair', 1: 'Poor' };
    return map[Number(rating)] || (rating !== null && rating !== undefined && rating !== '' ? String(rating) : '—');
  }

  // ─── PRIVATE: HTML BUILDER ────────────────────────────────────────────────
  // Marker for chunk split

  /**
   * Build the complete HTML for one student's result slip.
   *
   * IMPORTANT: Uses ONLY inline style="..." attributes.
   * No CSS variables, no external sheets, no <style> blocks with variables.
   * This is required because the GAS PDF renderer ignores CSS variables.
   *
   * @param {Object}  result         — assembled result object from assembleStudentResult_()
   * @param {boolean} isLastStudent  — when false, adds page-break-after:always
   * @returns {string} HTML fragment for this student
   */
  function buildSlipHtml_(result, isLastStudent) {
    // ── COLORS & SIZES (inline literals — no CSS variables) ──────────────
    var COLOR_PRIMARY   = '#003366';  // dark navy — school brand
    var COLOR_ACCENT    = '#336699';  // mid-blue for sub-headers
    var COLOR_BG_HEADER = '#003366';
    var COLOR_BG_TABLE  = '#f2f6fc';
    var COLOR_BORDER    = '#b0c4de';
    var COLOR_TEXT      = '#111111';
    var COLOR_WHITE     = '#ffffff';
    var COLOR_MUTED     = '#555555';
    var COLOR_PASS      = '#1a7a3c';  // green for grades A1/B2/B3
    var COLOR_FAIL      = '#c0392b';  // red for grades E8/F9

    var student  = result.student;
    var summary  = result.summary;
    var subjects = result.subjects;

    // ── Grade color helper (inline, no CSS class needed) ─────────────────
    function gradeColor(grade) {
      if (!grade) return COLOR_TEXT;
      var upper = String(grade).toUpperCase();
      if (['A1','B2','B3'].indexOf(upper) !== -1) return COLOR_PASS;
      if (['C4','C5','C6'].indexOf(upper) !== -1) return '#b8860b'; // amber
      return COLOR_FAIL;
    }

    // ── Page wrapper ──────────────────────────────────────────────────────
    var pageBreak = isLastStudent ? '' : 'page-break-after:always;';
    var html = '<div style="' + pageBreak + 'font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:' + COLOR_TEXT + ';width:720px;margin:0 auto;padding:20px 0;">';

    // ── LETTERHEAD ────────────────────────────────────────────────────────
    html += '<table style="width:100%;border-collapse:collapse;background:' + COLOR_BG_HEADER + ';padding:12px;" cellpadding="12" cellspacing="0"><tr>';
    html += '<td style="text-align:center;">';
    html += '<div style="font-size:18pt;font-weight:bold;color:' + COLOR_WHITE + ';letter-spacing:1px;">' + escapeHtml_(SCHOOL.name) + '</div>';
    html += '<div style="font-size:9pt;color:#cce0ff;margin-top:4px;">' + escapeHtml_(SCHOOL.address) + '</div>';
    html += '<div style="font-size:12pt;font-weight:bold;color:#ffdd99;margin-top:8px;text-transform:uppercase;letter-spacing:2px;">Student Report Card</div>';
    html += '</td>';
    html += '</tr></table>';

    // ── STUDENT INFO BAR ──────────────────────────────────────────────────
    html += '<table style="width:100%;border-collapse:collapse;margin-top:0;background:' + COLOR_BG_TABLE + ';border:1px solid ' + COLOR_BORDER + ';" cellpadding="6" cellspacing="0">';
    html += '<tr>';
    html += '<td style="width:50%;border-right:1px solid ' + COLOR_BORDER + ';">';
    // Stage 7: use slipName (SURNAME Firstname) for the name line on the PDF.
    // student.slipName is always set by assembleStudentResult_ (falls back to student.name).
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Name:</span> <span style="font-weight:bold;">' + escapeHtml_(student.slipName || student.name) + '</span>';
    html += '</td>';
    html += '<td style="width:25%;border-right:1px solid ' + COLOR_BORDER + ';">';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Student ID:</span> ' + escapeHtml_(student.studentId);
    html += '</td>';
    html += '<td style="width:25%;">';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Class:</span> ' + escapeHtml_(student.className);
    html += '</td>';
    html += '</tr>';
    html += '<tr>';
    html += '<td style="border-right:1px solid ' + COLOR_BORDER + ';">';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Session:</span> ' + escapeHtml_(result.session);
    html += '</td>';
    html += '<td style="border-right:1px solid ' + COLOR_BORDER + ';">';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Term:</span> ' + escapeHtml_(result.term);
    html += '</td>';
    html += '<td>';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Status:</span> ' + escapeHtml_(student.termStatus);
    html += '</td>';
    html += '</tr>';
    html += '</table>';

    // ── ACADEMIC PERFORMANCE TABLE ─────────────────────────────────────────
    html += '<div style="margin-top:14px;font-size:10pt;font-weight:bold;color:' + COLOR_PRIMARY + ';background:' + COLOR_BG_TABLE + ';padding:6px 8px;border-left:4px solid ' + COLOR_PRIMARY + ';">ACADEMIC PERFORMANCE</div>';
    html += '<table style="width:100%;border-collapse:collapse;margin-top:0;border:1px solid ' + COLOR_BORDER + ';" cellpadding="5" cellspacing="0">';

    // Table header row
    html += '<tr style="background:' + COLOR_ACCENT + ';color:' + COLOR_WHITE + ';font-size:9pt;">';
    html += '<th style="text-align:left;padding:5px 8px;border:1px solid #4a7cb5;" colspan="1">Subject</th>';
    COMPONENT_ORDER.forEach(function (comp) {
      html += '<th style="text-align:center;padding:5px 4px;border:1px solid #4a7cb5;">' + escapeHtml_(comp) + '</th>';
    });
    html += '<th style="text-align:center;padding:5px 4px;border:1px solid #4a7cb5;">Total</th>';
    html += '<th style="text-align:center;padding:5px 4px;border:1px solid #4a7cb5;">Grade</th>';
    html += '<th style="text-align:center;padding:5px 4px;border:1px solid #4a7cb5;">Position</th>';
    html += '<th style="text-align:center;padding:5px 4px;border:1px solid #4a7cb5;">Max</th>';
    html += '</tr>';

    subjects.forEach(function (subj, i) {
      var rowBg = (i % 2 === 0) ? COLOR_WHITE : COLOR_BG_TABLE;
      html += '<tr style="background:' + rowBg + ';font-size:9pt;">';
      html += '<td style="padding:4px 8px;border:1px solid ' + COLOR_BORDER + ';font-weight:bold;">' + escapeHtml_(subj.subjectName) + '</td>';
      COMPONENT_ORDER.forEach(function (comp) {
        var val = subj.scores[comp];
        html += '<td style="text-align:center;padding:4px;border:1px solid ' + COLOR_BORDER + ';">' + (val !== '' && val !== null && val !== undefined ? val : '—') + '</td>';
      });
      html += '<td style="text-align:center;font-weight:bold;padding:4px;border:1px solid ' + COLOR_BORDER + ';">' + (subj.total !== null ? subj.total : '—') + '</td>';
      html += '<td style="text-align:center;font-weight:bold;color:' + gradeColor(subj.grade) + ';padding:4px;border:1px solid ' + COLOR_BORDER + ';">' + (subj.grade || '—') + '</td>';
      html += '<td style="text-align:center;padding:4px;border:1px solid ' + COLOR_BORDER + ';">' + toOrdinal_(subj.position) + '</td>';
      html += '<td style="text-align:center;padding:4px;border:1px solid ' + COLOR_BORDER + ';">' + (subj.classMax !== null ? subj.classMax : '—') + '</td>';
      html += '</tr>';
    });

    html += '</table>';

    // ── SUMMARY BAR ───────────────────────────────────────────────────────
    html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;background:' + COLOR_BG_TABLE + ';border:1px solid ' + COLOR_BORDER + ';" cellpadding="6" cellspacing="0">';
    html += '<tr style="font-size:9.5pt;">';
    html += '<td style="border-right:1px solid ' + COLOR_BORDER + ';">';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Total Score:</span> <span style="font-weight:bold;">' + summary.totalScore + '</span>';
    html += '</td>';
    html += '<td style="border-right:1px solid ' + COLOR_BORDER + ';">';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Average:</span> <span style="font-weight:bold;">' + summary.averageScore + '</span>';
    html += '</td>';
    html += '<td style="border-right:1px solid ' + COLOR_BORDER + ';">';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Grade:</span> <span style="font-weight:bold;color:' + gradeColor(summary.overallGrade) + ';">' + (summary.overallGrade || '—') + '</span>';
    html += '</td>';
    html += '<td style="border-right:1px solid ' + COLOR_BORDER + ';">';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Position:</span> <span style="font-weight:bold;">' + toOrdinal_(summary.overallPosition) + ' of ' + summary.classSize + '</span>';
    html += '</td>';
    html += '<td>';
    html += '<span style="font-weight:bold;color:' + COLOR_MUTED + ';">Subjects:</span> ' + summary.subjectCount;
    html += '</td>';
    html += '</tr>';
    html += '</table>';

    // ── PSQ TABLE ─────────────────────────────────────────────────────────
    html += '<div style="margin-top:14px;font-size:10pt;font-weight:bold;color:' + COLOR_PRIMARY + ';background:' + COLOR_BG_TABLE + ';padding:6px 8px;border-left:4px solid ' + COLOR_PRIMARY + ';">PSYCHOMOTOR / SOCIO-AFFECTIVE QUALITIES</div>';
    html += '<table style="width:100%;border-collapse:collapse;margin-top:0;border:1px solid ' + COLOR_BORDER + ';" cellpadding="5" cellspacing="0">';

    var psqChunks = [];
    for (var t = 0; t < PSQ_TRAITS.length; t += 2) {
      psqChunks.push([PSQ_TRAITS[t], PSQ_TRAITS[t + 1]]);
    }

    psqChunks.forEach(function (pair, i) {
      var rowBg = (i % 2 === 0) ? COLOR_WHITE : COLOR_BG_TABLE;
      html += '<tr style="background:' + rowBg + ';font-size:9pt;">';
      pair.forEach(function (trait) {
        if (!trait) {
          html += '<td style="border:1px solid ' + COLOR_BORDER + ';" colspan="2"></td>';
          return;
        }
        var key    = toCamelCase(trait);
        var rating = result.psq[key];
        html += '<td style="padding:4px 8px;border:1px solid ' + COLOR_BORDER + ';width:30%;">' + escapeHtml_(trait) + '</td>';
        html += '<td style="text-align:center;padding:4px;border:1px solid ' + COLOR_BORDER + ';width:20%;font-weight:bold;">' + psqLabel_(rating) + '</td>';
      });
      html += '</tr>';
    });

    html += '</table>';

    // ── REMARK & FORM MASTER ───────────────────────────────────────────────
    html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;border:1px solid ' + COLOR_BORDER + ';" cellpadding="6" cellspacing="0">';
    html += '<tr style="background:' + COLOR_BG_TABLE + ';font-size:9.5pt;">';
    html += '<td style="width:20%;font-weight:bold;color:' + COLOR_MUTED + ';border-right:1px solid ' + COLOR_BORDER + ';">Form Master\'s Remark:</td>';
    html += '<td style="font-style:italic;">' + escapeHtml_(result.remark || '—') + '</td>';
    html += '</tr>';
    if (result.formMasterName) {
      html += '<tr style="font-size:9pt;">';
      html += '<td style="font-weight:bold;color:' + COLOR_MUTED + ';border-right:1px solid ' + COLOR_BORDER + ';border-top:1px solid ' + COLOR_BORDER + ';">Form Master:</td>';
      html += '<td style="border-top:1px solid ' + COLOR_BORDER + ';">' + escapeHtml_(result.formMasterName) + '</td>';
      html += '</tr>';
    }
    html += '</table>';

    // ── NEXT TERM INFO ─────────────────────────────────────────────────────
    if (result.nextTermFee || result.nextTermResumption) {
      html += '<table style="width:100%;border-collapse:collapse;margin-top:8px;background:#fffbe6;border:1px solid #e0c060;" cellpadding="6" cellspacing="0">';
      html += '<tr style="font-size:9pt;">';
      if (result.nextTermFee) {
        html += '<td style="border-right:1px solid #e0c060;"><span style="font-weight:bold;color:' + COLOR_MUTED + ';">Next Term Fee:</span> ' + escapeHtml_(result.nextTermFee) + '</td>';
      }
      if (result.nextTermResumption) {
        html += '<td><span style="font-weight:bold;color:' + COLOR_MUTED + ';">Resumption Date:</span> ' + escapeHtml_(result.nextTermResumption) + '</td>';
      }
      html += '</tr>';
      html += '</table>';
    }

    // ── TERM DATES ────────────────────────────────────────────────────────
    if (result.termStartDate || result.termEndDate) {
      html += '<div style="margin-top:6px;font-size:8.5pt;color:' + COLOR_MUTED + ';text-align:right;">';
      if (result.termStartDate) html += 'Term Start: ' + escapeHtml_(result.termStartDate);
      if (result.termStartDate && result.termEndDate) html += '&nbsp;&nbsp;|&nbsp;&nbsp;';
      if (result.termEndDate)   html += 'Term End: ' + escapeHtml_(result.termEndDate);
      html += '</div>';
    }

    html += '</div>'; // end page wrapper

    return html;
  }

  /**
   * Minimal HTML entity escaping to prevent XSS in generated PDF content.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml_(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  /**
   * Wrap one or more student HTML fragments in a complete HTML document
   * ready for GAS PDF conversion.
   *
   * @param {string} bodyContent — concatenated student HTML fragments
   * @param {string} title       — PDF document title
   * @returns {string} complete HTML document string
   */
  function wrapDocument_(bodyContent, title) {
    return (
      '<!DOCTYPE html>' +
      '<html><head><meta charset="UTF-8">' +
      '<title>' + escapeHtml_(title) + '</title>' +
      '<style>' +
        // Only non-variable CSS here — page layout for the PDF renderer
        '@page { margin: 1cm 1.2cm; }' +
        'body { margin:0; padding:0; font-family:Arial,Helvetica,sans-serif; }' +
      '</style>' +
      '</head><body>' +
      bodyContent +
      '</body></html>'
    );
  }

  // ─── PRIVATE: BULK DATA LOADER ───────────────────────────────────────────────

  /**
   * Load all data needed to render every student in a class group.
   * Called once at the start of generateBulkResultsPDF() — a single
   * call per data type, not one per student.
   *
   * @param {string[]} groupClassIds
   * @param {string}   activeTerm
   * @param {string}   activeSession
   * @returns {Object} { scoreLookup, psqLookup, remarkLookup, allGroupStudents,
   *                     activeStudentIds, subjectIds, subjectById, allStatusMap,
   *                     fmNameByClass }
   */
  function loadGroupData_(groupClassIds, activeTerm, activeSession) {
    // ── Students + statuses ─────────────────────────────────────────────
    var allGroupStudents = [];
    var allStatusMap     = {};
    groupClassIds.forEach(function (classId) {
      var statusMap = SheetService.getClassTermStatuses(classId, activeTerm, activeSession);
      Object.keys(statusMap).forEach(function (sid) { allStatusMap[sid] = statusMap[sid]; });
      var students  = SheetService.getCachedStudents(classId);
      students.forEach(function (s) {
        // Stage 7: build slipName (SURNAME Firstname) from the new cache columns.
        // Falls back to fullName if lastName is empty (cache not yet refreshed with new columns).
        var lastName       = (s.lastName        || '').trim();
        var firstMiddle    = (s.firstMiddleName  || '').trim();
        var computedSlip   = lastName
          ? (lastName.toUpperCase() + (firstMiddle ? ' ' + firstMiddle : ''))
          : '';
        allGroupStudents.push({
          studentId: String(s.studentId),
          name:      s.fullName || s.studentName || s.name || s.studentId,
          slipName:  computedSlip || s.fullName || s.studentId,   // used on PDF name line
          classId:   classId
        });
      });
    });

    var activeStudentIds = allGroupStudents
      .filter(function (s) {
        var status = allStatusMap[s.studentId] || STUDENT_STATUS.ACTIVE;
        return status === STUDENT_STATUS.ACTIVE;
      })
      .map(function (s) { return s.studentId; });

    // ── Subjects ────────────────────────────────────────────────────────
    var allAssignments = SheetService.getClassSubjectAssignments(activeSession);
    var subjectIdsSeen = {};
    var subjectIds     = [];
    allAssignments.forEach(function (csa) {
      var inGroup = groupClassIds.some(function (id) {
        return String(id) === String(csa.classId);
      });
      if (inGroup && !subjectIdsSeen[csa.subjectId]) {
        subjectIdsSeen[csa.subjectId] = true;
        subjectIds.push(String(csa.subjectId));
      }
    });

    var allSubjects = SheetService.getAllSubjects();
    var subjectById = {};
    allSubjects.forEach(function (s) { subjectById[s.subjectId] = s; });

    // ── Bulk reads ──────────────────────────────────────────────────────
    var groupScores  = SheetService.getScoresForClassGroup(groupClassIds, activeTerm, activeSession);
    var groupPSQ     = SheetService.getAllClassPSQForGroup(groupClassIds, activeTerm, activeSession);
    var groupRemarks = SheetService.getAllClassRemarksForGroup(groupClassIds, activeTerm, activeSession);

    // Build score lookup
    var scoreLookup = {};
    groupScores.forEach(function (r) {
      scoreLookup[r.studentId + '|' + r.subjectId + '|' + r.component] = r.score;
    });

    // Build PSQ lookup (studentId → PSQ row)
    var psqLookup = {};
    groupPSQ.forEach(function (r) { psqLookup[String(r.studentId)] = r; });

    // Build remark lookup (studentId → remark string)
    var remarkLookup = {};
    groupRemarks.forEach(function (r) {
      remarkLookup[String(r.studentId)] = r.remark || '';
    });

    // ── Form Master names per class ─────────────────────────────────────
    var fmNameByClass = {};
    groupClassIds.forEach(function (classId) {
      var fmAssignment = SheetService.getFormMasterAssignment(classId, activeSession);
      if (fmAssignment) {
        var fmStaff = SheetService.getUserById(fmAssignment.staffId);
        fmNameByClass[classId] = fmStaff ? (fmStaff.name || '') : '';
      } else {
        fmNameByClass[classId] = '';
      }
    });

    return {
      scoreLookup:     scoreLookup,
      psqLookup:       psqLookup,
      remarkLookup:    remarkLookup,
      allGroupStudents: allGroupStudents,
      activeStudentIds: activeStudentIds,
      subjectIds:      subjectIds,
      subjectById:     subjectById,
      allStatusMap:    allStatusMap,
      fmNameByClass:   fmNameByClass
    };
  }

  // ─── PUBLIC: GENERATE SINGLE RESULT SLIP PDF ────────────────────────────────

  /**
   * Generate a PDF for one student's result slip.
   *
   * Steps:
   *   1. Validate session and access rights.
   *   2. Look up student, class, and group.
   *   3. Load all bulk data for the group (scores, PSQ, remarks) — one read each.
   *   4. Assemble the student's result data.
   *   5. Build HTML with inline styles.
   *   6. Convert to PDF blob via Utilities.newBlob().getAs().
   *   7. Return base64-encoded bytes.
   *
   * @param {string} token
   * @param {string} studentId
   * @param {string} classId
   * @returns {{ success, data: { base64Pdf, filename } }}
   */
  function generateResultSlipPDF(token, studentId, classId) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    // Access check: admin can do anything; non-admin needs FM assignment for classId
    var isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1;
    if (!isAdmin) {
      var fmAssignments = SheetService.getFormMasterAssignmentsByStaff(sess.staffId);
      var fmClassIds    = fmAssignments.map(function (a) { return String(a.classId); });
      if (fmClassIds.indexOf(String(classId)) === -1) {
        return errorResponse('Unauthorised.', 'UNAUTHORISED');
      }
    }

    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;
    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // ── Look up the student ────────────────────────────────────────────────
    var students    = SheetService.getCachedStudents(classId);
    var studentRow  = students.find(function (s) {
      return String(s.studentId) === String(studentId);
    });
    if (!studentRow) {
      return errorResponse('Student not found.', 'NOT_FOUND');
    }
    var studentName = studentRow.fullName || studentRow.studentName || studentRow.name || studentId;

    // Stage 7: build slipName (SURNAME Firstname) for the PDF name line.
    // Uses the new lastName and firstMiddleName columns added to Students Cache in Stage 7.
    // Falls back to studentName (first-last order) if those columns are not yet populated.
    var lastName    = (studentRow.lastName       || '').trim();
    var firstMiddle = (studentRow.firstMiddleName || '').trim();
    var slipName    = lastName
      ? (lastName.toUpperCase() + (firstMiddle ? ' ' + firstMiddle : ''))
      : studentName;

    // ── Resolve group ──────────────────────────────────────────────────────
    var allClasses    = SheetService.getAllClasses();
    var cls           = allClasses.find(function (c) { return c.classId === classId; }) || {};
    var className     = cls.className || classId;
    var groupKey      = getGroupKey_(className);
    var groupClassIds = allClasses
      .filter(function (c) { return getGroupKey_(c.className) === groupKey; })
      .map(function (c) { return c.classId; });

    // ── Load all bulk data for the group ───────────────────────────────────
    var gd = loadGroupData_(groupClassIds, activeTerm, activeSession);

    // ── Assemble result ────────────────────────────────────────────────────
    var result = assembleStudentResult_(
      studentId, classId, className,
      activeTerm, activeSession, settings,
      gd.scoreLookup,
      gd.allGroupStudents, gd.activeStudentIds, gd.subjectIds, gd.subjectById,
      gd.allStatusMap, gd.psqLookup, gd.remarkLookup,
      gd.fmNameByClass[classId] || '', studentName, slipName   // slipName added Stage 7
    );

    // ── Build HTML and convert to PDF ─────────────────────────────────────
    var slipHtml    = buildSlipHtml_(result, true /* isLastStudent */);
    var fullHtml    = wrapDocument_(slipHtml, 'Result Slip — ' + studentName);
    var pdfBlob     = Utilities.newBlob(fullHtml, 'text/html').getAs('application/pdf');
    var base64Pdf   = Utilities.base64Encode(pdfBlob.getBytes());

    // Sanitise student name for use as a filename (remove characters unsafe in filenames)
    var safeName    = String(studentName).replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_');
    var filename    = safeName + '_' + String(activeTerm).replace(/\s+/g, '_') + '_' + String(activeSession).replace(/\//g, '-') + '.pdf';

    return successResponse({ base64Pdf: base64Pdf, filename: filename });
  }

  // ─── PUBLIC: GENERATE BULK RESULTS PDF ──────────────────────────────────────

  /**
   * Generate a combined PDF with one result slip per active student in the group.
   *
   * Steps:
   *   1. Validate session and access.
   *   2. Resolve group classIds.
   *   3. Load all bulk data once for the whole group.
   *   4. For each active student: assemble result and build HTML slip.
   *   5. Concatenate all slips (with page-break-after:always between them).
   *   6. Convert to PDF blob and return base64.
   *
   * @param {string} token
   * @param {string} classGroupKey — e.g. "JSS 2" or "SSS 1"
   * @returns {{ success, data: { base64Pdf, filename, studentCount } }}
   */
  function generateBulkResultsPDF(token, classGroupKey) {
    var sess = AuthService.validateToken(token);
    if (!sess) return errorResponse('Session expired.', 'SESSION_EXPIRED');

    var settings      = SheetService.getSessionSettings();
    var activeSession = settings.activeSession;
    var activeTerm    = settings.activeTerm;
    if (!activeSession || !activeTerm) {
      return errorResponse('No active session/term configured.', 'NO_SESSION');
    }

    // ── Resolve group ──────────────────────────────────────────────────────
    var allClasses    = SheetService.getAllClasses();
    var groupClassIds = allClasses
      .filter(function (c) { return getGroupKey_(c.className) === classGroupKey; })
      .map(function (c) { return c.classId; });

    if (groupClassIds.length === 0) {
      return errorResponse('No classes found for group "' + classGroupKey + '".', 'NOT_FOUND');
    }

    // ── Access check ───────────────────────────────────────────────────────
    var isAdmin = [ROLES.ADMIN, ROLES.SUPER_ADMIN].indexOf(sess.role) !== -1;
    if (!isAdmin) {
      var fmAssignments = SheetService.getFormMasterAssignmentsByStaff(sess.staffId);
      var fmClassIds    = fmAssignments.map(function (a) { return String(a.classId); });
      var hasAccess     = groupClassIds.some(function (id) {
        return fmClassIds.indexOf(String(id)) !== -1;
      });
      if (!hasAccess) {
        return errorResponse('Unauthorised.', 'UNAUTHORISED');
      }
    }

    // ── Load all bulk data for the group (one read per data type) ──────────
    var gd = loadGroupData_(groupClassIds, activeTerm, activeSession);

    if (gd.activeStudentIds.length === 0) {
      return errorResponse('No active students found in this class group.', 'NO_STUDENTS');
    }

    // ── Build one slip per active student ──────────────────────────────────
    var allSlipsHtml = '';
    var total        = gd.activeStudentIds.length;

    gd.allGroupStudents.forEach(function (studentObj, idx) {
      var sid = studentObj.studentId;
      // Only render active students
      var status = gd.allStatusMap[sid] || STUDENT_STATUS.ACTIVE;
      if (status !== STUDENT_STATUS.ACTIVE) return;

      var isLast  = (gd.activeStudentIds.indexOf(sid) === total - 1);
      var cls     = allClasses.find(function (c) { return c.classId === studentObj.classId; }) || {};
      var clsName = cls.className || studentObj.classId;

      var result = assembleStudentResult_(
        sid, studentObj.classId, clsName,
        activeTerm, activeSession, settings,
        gd.scoreLookup,
        gd.allGroupStudents, gd.activeStudentIds, gd.subjectIds, gd.subjectById,
        gd.allStatusMap, gd.psqLookup, gd.remarkLookup,
        gd.fmNameByClass[studentObj.classId] || '', studentObj.name, studentObj.slipName   // slipName added Stage 7
      );

      allSlipsHtml += buildSlipHtml_(result, isLast);
    });

    // ── Convert concatenated HTML to PDF ───────────────────────────────────
    var fullHtml  = wrapDocument_(allSlipsHtml, classGroupKey + ' — All Results — ' + activeTerm + ' ' + activeSession);
    var pdfBlob   = Utilities.newBlob(fullHtml, 'text/html').getAs('application/pdf');
    var base64Pdf = Utilities.base64Encode(pdfBlob.getBytes());

    var safeGroup = String(classGroupKey).replace(/\s+/g, '_');
    var filename  = safeGroup + '_All_Results_' + String(activeTerm).replace(/\s+/g, '_') + '_' + String(activeSession).replace(/\//g, '-') + '.pdf';

    return successResponse({
      base64Pdf:    base64Pdf,
      filename:     filename,
      studentCount: total
    });
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────────

  return {
    generateResultSlipPDF,
    generateBulkResultsPDF
  };

})();

