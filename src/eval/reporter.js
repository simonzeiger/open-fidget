'use strict';

/**
 * Layer 3: Crisp, structured terminal reporter (`src/eval/reporter.js`)
 * formatting `evaluateMode` and `evaluateAll` outputs.
 */

function padRight(str, width) {
  const s = String(str);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(str, width) {
  const s = String(str);
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

function fmtNum(n, digits = 2) {
  if (!Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function formatVerdictBadge(verdict) {
  if (verdict === 'PASS') return '[PASS]';
  if (verdict === 'NEEDS_TUNING') return '[TUNE]';
  return '[FAIL]';
}

function severityTag(sev) {
  if (sev === 'error') return 'ERROR';
  if (sev === 'warn') return 'WARN ';
  return 'INFO ';
}

function formatEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return '';
  const keys = Object.keys(evidence);
  if (keys.length === 0) return '';
  const parts = [];
  for (const k of keys) {
    const val = evidence[k];
    if (val === undefined || val === null) continue;
    if (typeof val === 'object') {
      parts.push(`${k}=${JSON.stringify(val)}`);
    } else {
      parts.push(`${k}=${val}`);
    }
  }
  return parts.join(', ');
}

function renderVariantSection(mode, r, options = {}) {
  const lines = [];
  const header = `${mode.name} (${mode.id}:${r.variant}) [${r.variantKind}]`;
  lines.push(
    `${formatVerdictBadge(r.verdict)} ${padRight(header, 44)} Score: ${padLeft(r.overallScore, 3)}/100`
  );

  // Profile metrics table
  const profileNames = Object.keys(r.profiles || {});
  if (profileNames.length > 0) {
    lines.push('  Profiles:');
    lines.push(
      '    Profile   | AvgScore | Progress | Success | Pulses | DeadAir(ms)'
    );
    lines.push(
      '    ----------+----------+----------+---------+--------+------------'
    );
    for (const pName of profileNames) {
      const p = r.profiles[pName];
      lines.push(
        `    ${padRight(pName, 9)} | ${padLeft(fmtNum(p.avgScore), 8)} | ${padLeft(
          fmtNum(p.avgProgress),
          8
        )} | ${padLeft(`${Math.round((p.successRate || 0) * 100)}%`, 7)} | ${padLeft(
          fmtNum(p.avgPulses, 1),
          6
        )} | ${padLeft(p.maxActiveDeadAirMs ?? 0, 11)}`
      );
    }
  }

  // Baseline & lift (for puzzles)
  if (r.baseline) {
    const b = r.baseline;
    lines.push(
      `  Blind Lift: random=${fmtNum(b.randomScore)} | idealLift=+${fmtNum(
        b.idealLift
      )} | typicalLift=+${fmtNum(b.typicalLift)} | pocketLift=+${fmtNum(b.pocketLift)}`
    );
  }

  // Hygiene & fuzz stats
  const h = r.hygiene;
  const f = r.fuzz;
  lines.push(
    `  Hygiene:    collisions=${h.hardCollisions} (<35ms) | tight=${h.tightGaps} (<55ms) | minGap=${
      h.minGapMs === null ? '-' : `${fmtNum(h.minGapMs, 1)}ms`
    } | activeDeadAir=${h.maxActiveDeadAirMs}ms`
  );
  lines.push(
    `              density=${fmtNum(h.pulsesPerSecond)}/s | energy=${fmtNum(
      h.energyPerSecond
    )}/s | acoustic=${h.acousticRisk} | cueCollisions=${h.ambiguousCues} | pulses=${h.totalPulses}`
  );
  lines.push(
    `  Fuzz/Clean: steps=${f.steps} | crashes=${f.crashes} | runaway=${f.runawayErrors} | leakedTimers=${f.leakedTimers}`
  );

  // Actionable findings
  if (r.findings && r.findings.length > 0) {
    const maxFindings = Number.isInteger(options.maxFindings) ? options.maxFindings : 10;
    lines.push('  Findings:');
    for (const finding of r.findings.slice(0, maxFindings)) {
      lines.push(`    - [${severityTag(finding.severity)}] ${finding.code}: ${finding.message}`);
      const evStr = formatEvidence(finding.evidence);
      if (evStr && options.verbose !== false) {
        lines.push(`        evidence: ${evStr}`);
      }
    }
  } else {
    lines.push('  Findings:   (none — clean run)');
  }

  return lines.join('\n');
}

function formatReport(evalResult, options = {}) {
  const { mode, results, summary } = evalResult;
  const lines = [];
  const bar = '='.repeat(78);

  lines.push(bar);
  lines.push(
    `OPEN FIDGET VALIDATION: ${mode.name} (${mode.id}) — ${formatVerdictBadge(
      summary.verdict
    )} ${summary.overallScore}/100`
  );
  lines.push(
    `Summary: errors=${summary.errorCount}, warnings=${summary.warnCount}, info=${summary.infoCount}`
  );
  lines.push(bar);

  for (let i = 0; i < results.length; i += 1) {
    lines.push(renderVariantSection(mode, results[i], options));
    if (i < results.length - 1) {
      lines.push('-'.repeat(78));
    }
  }

  lines.push(bar);
  return lines.join('\n');
}

function formatAllReports(allResults, options = {}) {
  const { modes, summary } = allResults;
  const lines = [];
  const bar = '='.repeat(92);
  const subBar = '-'.repeat(92);

  lines.push(bar);
  lines.push('OPEN FIDGET HEADLESS VALIDATION LAB — EXECUTIVE REPORT');
  lines.push(
    `Variants Evaluated: ${summary.totalVariants} | PASS: ${summary.passCount} | NEEDS_TUNING: ${summary.tuneCount} | FAIL: ${summary.failCount}`
  );
  lines.push(bar);
  lines.push(
    'Mode/Variant          | Kind   | Verdict | Score | Ideal->Pocket | Collisions | DeadAir | Acoustic'
  );
  lines.push(
    '----------------------+--------+---------+-------+---------------+------------+---------+---------'
  );

  for (const m of modes) {
    for (const r of m.results) {
      const label = `${m.mode.id}:${r.variant}`;
      const idealScore = r.profiles.ideal ? fmtNum(r.profiles.ideal.avgScore, 1) : '-';
      const pocketScore = r.profiles.pocket ? fmtNum(r.profiles.pocket.avgScore, 1) : '-';
      const scoreDrift =
        r.variantKind === 'puzzle'
          ? `${idealScore} -> ${pocketScore}`
          : `${r.profiles.ideal ? fmtNum(r.profiles.ideal.avgProgress, 1) : '-'} prog`;
      const h = r.hygiene;
      lines.push(
        `${padRight(label, 21)} | ${padRight(r.variantKind, 6)} | ${padRight(
          r.verdict,
          7
        )} | ${padLeft(r.overallScore, 5)} | ${padRight(scoreDrift, 13)} | ${padLeft(
          h.hardCollisions,
          10
        )} | ${padLeft(`${h.maxActiveDeadAirMs}ms`, 7)} | ${padRight(h.acousticRisk, 8)}`
      );
    }
  }

  lines.push(bar);
  lines.push('KEY ACTIONABLE FINDINGS BY MODE');
  lines.push(subBar);

  for (const m of modes) {
    lines.push(
      `> ${m.mode.name} (${m.mode.id}) — ${formatVerdictBadge(m.summary.verdict)} ${m.summary.overallScore}/100`
    );
    for (const r of m.results) {
      const topFindings = (r.findings || []).filter((f) => f.severity !== 'info' || r.findings.length === 1);
      const list = topFindings.length > 0 ? topFindings : r.findings || [];
      if (list.length === 0) {
        lines.push(`  [${r.variant}] No issues detected.`);
      } else {
        for (const f of list) {
          lines.push(`  [${r.variant}] ${severityTag(f.severity)} ${f.code}: ${f.message}`);
          if (options.verbose !== false) {
            const evStr = formatEvidence(f.evidence);
            if (evStr) {
              lines.push(`            evidence: ${evStr}`);
            }
          }
        }
      }
    }
    lines.push(subBar);
  }

  return lines.join('\n');
}

module.exports = {
  formatReport,
  formatAllReports,
};
