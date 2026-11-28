import React, { useMemo, useState } from 'react'
import AppIcon from './AppIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { WAVE5_SPECTRUM_SNAPSHOT } from './propFleetWave5Fixture.js'
import {
  LEGACY_W4_P1_P2_LABEL_EN,
  LEGACY_W4_P1_P2_LABEL_VI,
  NUMERIC_GRADE_BANDS,
  SCHEDULE_DISPLAY_META,
  bottleneckLabel,
  buildScorecardFromSpectrumRow,
  formatWave5CompactVnd,
  formatWave5Number,
  formatWave5Pct,
  gradeLabel,
  gradePinPercent,
  gradeTone,
  inspectT5Warning,
} from './propFleetWave5Model.js'
import './prop-fleet-wave5.css'

const PROFILE_LABELS = {
  ftmo_standard_10k: 'FTMO Standard 10K (10,000 USD)',
  ftmo_standard_100k: 'FTMO Standard 100K (100,000 USD)',
}

function GradePill({ grade, language, testId }) {
  const tone = gradeTone(grade)
  const label = gradeLabel(grade, language)
  return (
    <span className={`pf-pill is-${tone}`} data-grade={grade} data-testid={testId}>
      <span className="pf-dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

function PartitionBar({ title, passPct, failPct, pendingPct, language, testId }) {
  const sum = passPct + failPct + pendingPct
  const labels = language === 'en'
    ? { pass: 'Pass', fail: 'Fail', pending: 'Pending', sum: 'Sum' }
    : { pass: 'Đậu', fail: 'Rớt', pending: 'Chờ', sum: 'Tổng' }
  return (
    <div className="pf-w5-part-row" data-testid={testId}>
      <div className="pf-w5-part-meta">
        <span className="pf-w5-part-title">{title}</span>
        <span className="pf-w5-part-numbers">
          {labels.pass} {formatWave5Pct(passPct)} · {labels.fail} {formatWave5Pct(failPct)} · {labels.pending} {formatWave5Pct(pendingPct)} ({labels.sum} {formatWave5Pct(sum, 1)})
        </span>
      </div>
      <div
        className="pf-w5-part-bar"
        role="img"
        aria-label={`${title}: ${labels.pass} ${formatWave5Pct(passPct)}, ${labels.fail} ${formatWave5Pct(failPct)}, ${labels.pending} ${formatWave5Pct(pendingPct)}`}
      >
        <span className="pf-w5-part-pass" style={{ width: `${Math.max(0, passPct)}%` }} />
        <span className="pf-w5-part-fail" style={{ width: `${Math.max(0, failPct)}%` }} />
        <span className="pf-w5-part-pending" style={{ width: `${Math.max(0, pendingPct)}%` }} />
      </div>
    </div>
  )
}

export default function PropFleetSpectrumPanel() {
  const { t, language } = useTestingLocale()
  const [profileId, setProfileId] = useState('ftmo_standard_10k')
  const [frictionMult, setFrictionMult] = useState(1.0)
  const [scheduleId, setScheduleId] = useState('T3_BALANCED_EV')

  const filteredRows = useMemo(
    () => WAVE5_SPECTRUM_SNAPSHOT.tier_a_rows.filter(
      r => r.contract_id === profileId && r.friction_mult === frictionMult,
    ),
    [profileId, frictionMult],
  )

  const selectedRow = useMemo(
    () => filteredRows.find(r => r.schedule_id === scheduleId) || filteredRows[0] || null,
    [filteredRows, scheduleId],
  )

  const scorecardResult = useMemo(
    () => (selectedRow
      ? buildScorecardFromSpectrumRow(selectedRow, {
        taxonomy_sha256: WAVE5_SPECTRUM_SNAPSHOT.taxonomy_sha256,
      })
      : { ok: false, code: 'NO_SPECTRUM_ROW', message: 'No matching spectrum row.' }),
    [selectedRow],
  )

  const t5Status = useMemo(() => inspectT5Warning(selectedRow), [selectedRow])

  const intradayMatch = useMemo(() => {
    if (!selectedRow) return null
    return WAVE5_SPECTRUM_SNAPSHOT.intraday_dd_audit.find(
      item => item.contract_id === selectedRow.contract_id && item.schedule_id === selectedRow.schedule_id,
    ) || null
  }, [selectedRow])

  const w4BaselineRow = useMemo(
    () => WAVE5_SPECTRUM_SNAPSHOT.wave4_vs_wave5.by_profile_and_friction.find(
      r => r.campaign_id === 'offensive4' && r.friction_mult === frictionMult,
    ) || null,
    [frictionMult],
  )

  const w5FleetRows = useMemo(
    () => WAVE5_SPECTRUM_SNAPSHOT.wave4_vs_wave5.by_profile_and_friction.filter(
      r => r.campaign_id === 'offensive5_spectrum' && r.friction_mult === frictionMult,
    ),
    [frictionMult],
  )

  const pairedDeltasByProfile = useMemo(() => {
    const map = new Map()
    for (const item of WAVE5_SPECTRUM_SNAPSHOT.wave4_vs_wave5.paired_162_cell_deltas) {
      map.set(item.w5_profile, item)
    }
    return map
  }, [])

  const selectedMeta = selectedRow ? SCHEDULE_DISPLAY_META[selectedRow.schedule_id] : null
  const scorecard = scorecardResult.ok ? scorecardResult.scorecard : null
  const overallPin = selectedRow ? gradePinPercent(selectedRow.overall_grade) : null

  return (
    <div className="pf-w5-stack" data-testid="pf-w5-spectrum-panel">
      {/* Controls & Contract Disclosure Strip */}
      <div className="pf-w5-controls" data-testid="pf-w5-spectrum-controls">
        <div className="pf-w5-control-group">
          <span className="pf-w5-control-label">{t('Gói tài khoản')}</span>
          <div className="pf-w5-seg-group" role="group" aria-label={t('Chọn gói tài khoản')}>
            {WAVE5_SPECTRUM_SNAPSHOT.profiles.map(pid => (
              <button
                key={pid}
                type="button"
                className="pf-w5-seg-btn"
                aria-pressed={profileId === pid}
                data-testid={pid === 'ftmo_standard_10k' ? 'pf-w5-profile-10k' : 'pf-w5-profile-100k'}
                onClick={() => setProfileId(pid)}
              >
                {PROFILE_LABELS[pid] || pid}
              </button>
            ))}
          </div>
        </div>

        <div className="pf-w5-control-group">
          <span className="pf-w5-control-label">{t('Ma sát khớp lệnh')}</span>
          <div className="pf-w5-seg-group" role="group" aria-label={t('Chọn mức ma sát khớp lệnh')}>
            <button
              type="button"
              className="pf-w5-seg-btn"
              aria-pressed={frictionMult === 1.0}
              data-testid="pf-w5-friction-1x"
              onClick={() => setFrictionMult(1.0)}
            >
              {t('1.0x Chuẩn')}
            </button>
            <button
              type="button"
              className="pf-w5-seg-btn"
              aria-pressed={frictionMult === 1.5}
              data-testid="pf-w5-friction-15x"
              onClick={() => setFrictionMult(1.5)}
            >
              {t('1.5x Căng thẳng')}
            </button>
          </div>
        </div>
      </div>

      {/* evaluation-scorecard@1.0.0 Scope, Evidence & Resolution Disclosure */}
      <div className="pf-w5-contract-strip" data-testid="pf-w5-contract-strip">
        <span className="pf-pill is-info">
          <span className="pf-dot" aria-hidden="true" />
          <span>evaluation-scorecard@1.0.0 · T1_CFD_PROP</span>
        </span>
        <span className="pf-pill is-neutral">
          <span className="pf-dot" aria-hidden="true" />
          <span>{t('Đơn vé không thử lại (Zero-Retry)')} · ALL_REGULAR_SSOT</span>
        </span>
        <span className="pf-pill is-warning">
          <span className="pf-dot" aria-hidden="true" />
          <span>{t('DEV_CONSUMED_OOS · XẤP XỈ CẤP NGÀY (APPROX_DAILY)')}</span>
        </span>
        <span className="pf-pill is-neutral">
          <AppIcon name="shield" size={13} />
          <span>
            {t('Cổng W5-G14 · {cases} kịch bản chấm điểm · X13 100%', {
              cases: WAVE5_SPECTRUM_SNAPSHOT.counts.total_graded_cases,
            })}
          </span>
        </span>
      </div>

      {/* Quick Schedule Selector (T1..T5 + Bellman DP + C00/C10/Sprint) */}
      <div className="pf-tier-tabs" role="group" aria-label={t('Chọn bậc tốc độ thi quỹ')}>
        {filteredRows.map(row => {
          const meta = SCHEDULE_DISPLAY_META[row.schedule_id]
          const isT5 = row.schedule_id === 'T5_MAX_THROTTLE_YOLO'
          return (
            <button
              key={row.schedule_id}
              type="button"
              className={`pf-w5-seg-btn ${isT5 ? 'is-danger-tier' : ''}`}
              aria-pressed={selectedRow?.schedule_id === row.schedule_id}
              data-testid={`pf-w5-sched-btn-${row.schedule_id}`}
              onClick={() => setScheduleId(row.schedule_id)}
            >
              {meta?.short || row.schedule_id}
              {isT5 ? ' !' : ''}
            </button>
          )
        })}
      </div>

      {/* Fail-Closed Scorecard Error Guard */}
      {!scorecardResult.ok && (
        <div className="pf-alert is-danger" role="alert" data-testid="pf-w5-scorecard-error">
          <AppIcon name="error" size={16} />
          <div className="pf-alert-body">
            <span className="pf-alert-code">[{scorecardResult.code}]</span>
            <span>{scorecardResult.message}</span>
          </div>
        </div>
      )}

      {/* T5 Gambling / Research-Boundary Warning Banner */}
      {t5Status.isT5Boundary && (
        <div className="pf-alert is-danger" role="alert" data-testid="pf-w5-t5-warning">
          <AppIcon name="warning" size={16} />
          <div className="pf-alert-body">
            <span className="pf-alert-code">[RESEARCH_BOUNDARY_ONLY · FTMO_GAMBLING_ALLIN_RISK]</span>
            <span>
              {t('Bậc T5 (8.5x / 6.5x) chỉ dùng đo biên nghiên cứu, vượt trần Shield A 3.0% và có rủi ro bị hãng xếp loại hành vi đánh cược quá mức.')}
              {intradayMatch
                ? ` ${t('Kiểm toán theo chuỗi lệnh M1: tỷ lệ chạm giới hạn lỗ ngày 5% là {base}% (1.0x) và {gap}% (gap 1.25x).', {
                  base: formatWave5Number(intradayMatch.trade_level_1_0x_daily_breach_pct, 2),
                  gap: formatWave5Number(intradayMatch.trade_level_1_25x_gap_daily_breach_pct, 2),
                })}`
                : ''}
            </span>
          </div>
        </div>
      )}

      {/* Selected Schedule 4-Color Scorecard Gauge + 100% Partitions + Exact Bottlenecks */}
      {selectedRow && scorecard && (
        <section className="pf-w5-scorecard-grid" aria-label={t('Thẻ điểm 4 màu chuẩn hóa')} data-testid="pf-w5-scorecard-gauge">
          <div className="pf-w5-scorecard-cell">
            <div className="pf-w5-gauge-head">
              <h3>{language === 'en' ? selectedMeta?.en || selectedRow.schedule_id : selectedMeta?.vi || selectedRow.schedule_id}</h3>
              <GradePill grade={selectedRow.overall_grade} language={language} testId="pf-w5-overall-grade" />
            </div>

            {/* 4-Color Numeric Gauge Track (BAD -> ADEQUATE -> GOOD -> TOP_1_PCT) */}
            <div className="pf-w5-gauge-wrap">
              <div
                className="pf-w5-gauge-track"
                role="img"
                aria-label={`${t('Xếp hạng tổng thể')}: ${gradeLabel(selectedRow.overall_grade, language)}`}
              >
                <span className="pf-w5-gauge-seg is-bad" />
                <span className="pf-w5-gauge-seg is-adequate" />
                <span className="pf-w5-gauge-seg is-good" />
                <span className="pf-w5-gauge-seg is-top1" />
                {overallPin !== null && (
                  <span
                    className="pf-w5-gauge-pin"
                    style={{ left: `${overallPin}%` }}
                    data-testid="pf-w5-gauge-pin"
                  />
                )}
              </div>
              <div className="pf-w5-gauge-labels">
                {NUMERIC_GRADE_BANDS.map(band => (
                  <span key={band} className={selectedRow.overall_grade === band ? 'is-active' : ''}>
                    {gradeLabel(band, language)}
                  </span>
                ))}
              </div>
            </div>

            {/* 4 Phases Breakdown: P1 / P2 / Pass P1+P2 / Funded 12T */}
            <div className="pf-w5-phase-grid" data-testid="pf-w5-phase-grid">
              <div className="pf-w5-phase-card">
                <span className="pf-w5-phase-name">{t('Vòng 1 (P1 12T)')}</span>
                <GradePill grade={selectedRow.phase_grades.p1} language={language} />
                <span className="pf-w5-phase-stat">{t('Đậu')}: {formatWave5Pct(selectedRow.p1_pass_12m_pct)}</span>
              </div>
              <div className="pf-w5-phase-card">
                <span className="pf-w5-phase-name">{t('Vòng 2 (P2 12T)')}</span>
                <GradePill grade={selectedRow.phase_grades.p2} language={language} />
                <span className="pf-w5-phase-stat">{t('Đậu')}: {formatWave5Pct(selectedRow.p2_pass_12m_pct)}</span>
              </div>
              <div className="pf-w5-phase-card">
                <span className="pf-w5-phase-name">{t('Đậu đủ P1+P2')}</span>
                <GradePill grade={selectedRow.phase_grades.pass_eval} language={language} />
                <span className="pf-w5-phase-stat">{t('Đậu')}: {formatWave5Pct(selectedRow.pass_eval_12m_pct)}</span>
              </div>
              <div className="pf-w5-phase-card">
                <span className="pf-w5-phase-name">{t('Funded 12T & Rút #1')}</span>
                <GradePill grade={selectedRow.phase_grades.funded_12m} language={language} />
                <span className="pf-w5-phase-stat">
                  {t('Cháy')}: {formatWave5Pct(selectedRow.fn12_blowup_pct)} · {formatWave5Number(selectedRow.cond_med_pay1_days, 1)}d
                </span>
              </div>
            </div>

            {/* Balanced Strategy & Prop Metrics */}
            <dl className="pf-w5-metrics-grid">
              <div>
                <dt>{t('Tỷ lệ thắng / RR')}</dt>
                <dd>{formatWave5Pct(selectedRow.winrate_pct)} / {formatWave5Number(selectedRow.avg_rr, 2)}</dd>
              </div>
              <div>
                <dt>{t('PF / Max DD')}</dt>
                <dd>{formatWave5Number(selectedRow.pf, 2)} / {formatWave5Pct(selectedRow.max_dd_pct)}</dd>
              </div>
              <div>
                <dt>{t('Sharpe / Calmar')}</dt>
                <dd>{formatWave5Number(selectedRow.sharpe, 2)} / {formatWave5Number(selectedRow.calmar, 2)}</dd>
              </div>
              <div>
                <dt>{t('EV / 1 đồng phí (24T)')}</dt>
                <dd>{formatWave5Number(selectedRow.ev_per_fee_npv24, 2)}x ({formatWave5CompactVnd(selectedRow.ev_npv_24m_vnd, language)})</dd>
              </div>
              <div>
                <dt>{t('Rút #1 không điều kiện')}</dt>
                <dd>{formatWave5Number(selectedRow.uncond_med_pay1_cap730, 1)} {t('ngày')}</dd>
              </div>
              <div>
                <dt>{t('Rút #1 có điều kiện')}</dt>
                <dd>{formatWave5Number(selectedRow.cond_med_pay1_days, 1)} {t('ngày')}</dd>
              </div>
              <div>
                <dt>{t('Xác suất NPV 24T <= 0')}</dt>
                <dd>{formatWave5Pct(selectedRow.p_npv24_le_0_pct)}</dd>
              </div>
              <div>
                <dt>{t('Trần Wilson 95% cháy Fn12')}</dt>
                <dd>{formatWave5Pct(selectedRow.fn12_wilson_ub_pct)}</dd>
              </div>
            </dl>
          </div>

          {/* Right Cell: Exact 100.0% Partition Bars + Exact Bottleneck Chips */}
          <div className="pf-w5-scorecard-cell">
            <div className="pf-w5-gauge-head">
              <h3>{t('Phân rã 100.0% Đậu / Rớt / Chờ (12T)')}</h3>
              <span className="pf-pill is-neutral">
                <span className="pf-dot" aria-hidden="true" />
                <span>{frictionMult.toFixed(1)}x</span>
              </span>
            </div>

            <div className="pf-w5-partitions">
              <PartitionBar
                title={t('Vòng 1 (P1 12T)')}
                passPct={selectedRow.p1_pass_12m_pct}
                failPct={selectedRow.p1_fail_12m_pct}
                pendingPct={selectedRow.p1_pending_12m_pct}
                language={language}
                testId="pf-w5-partition-p1"
              />
              <PartitionBar
                title={t('Vòng 2 (P2 12T)')}
                passPct={selectedRow.p2_pass_12m_pct}
                failPct={selectedRow.p2_fail_12m_pct}
                pendingPct={selectedRow.p2_pending_12m_pct}
                language={language}
                testId="pf-w5-partition-p2"
              />
              <PartitionBar
                title={t('Vượt đủ vòng thi (P1+P2 12T)')}
                passPct={selectedRow.pass_eval_12m_pct}
                failPct={selectedRow.fail_eval_12m_pct}
                pendingPct={selectedRow.pending_eval_12m_pct}
                language={language}
                testId="pf-w5-partition-eval"
              />
            </div>

            <div className="pf-w5-gauge-head">
              <h3>{t('Nút thắt chặn Top 1%')}</h3>
              <span className="pf-pill is-warning">
                <span className="pf-dot" aria-hidden="true" />
                <span>{scorecard.exact_bottlenecks.length} {t('nút thắt')}</span>
              </span>
            </div>

            <div className="pf-w5-bottleneck-list" data-testid="pf-w5-bottlenecks">
              {scorecard.exact_bottlenecks.map(bn => (
                <div key={bn.code} className="pf-w5-bottleneck-item" data-testid={`pf-w5-bn-${bn.code}`}>
                  <span className="pf-w5-bottleneck-rank">#{bn.severity_rank}</span>
                  <span className="pf-mono">{bn.code}</span>
                  <span>{bottleneckLabel(bn.code, language)}</span>
                </div>
              ))}
            </div>

            <p className="pf-w5-note">
              {t('Khoảng cách tới Top 1%: cần cải thiện thời gian rút #1, giữ xác suất NPV 24T âm dưới ngưỡng và hoàn tất đối chứng Holdout 2025+ cùng Demo/Live thực địa.')}
            </p>
          </div>
        </section>
      )}

      {/* Full Spectrum Matrix: 9 Schedules x 4 Phases */}
      <section className="pf-section" aria-labelledby="pf-w5-matrix-title">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-w5-matrix-title">{t('Ma trận Phổ Tốc độ Wave 5 (T1–T5, Bellman DP & Đối chứng)')}</h2>
            <p className="pf-section-sub">
              {t('Chọn bất kỳ hàng nào để nạp thẻ điểm 4 màu và phân rã 100.0% ở phía trên.')}
            </p>
          </div>
        </div>

        <div className="wm-table-scroll pf-table-wrap" data-scroll-axis="x">
          <table className="wm-data-table" data-testid="pf-w5-spectrum-table">
            <thead>
              <tr>
                <th scope="col">{t('Bậc tốc độ')}</th>
                <th scope="col">{t('Hạng tổng')}</th>
                <th scope="col" className="is-numeric">{t('P1 (Đậu/Rớt/Chờ)')}</th>
                <th scope="col" className="is-numeric">{t('P2 (Đậu/Rớt/Chờ)')}</th>
                <th scope="col" className="is-numeric">{t('Pass P1+P2')}</th>
                <th scope="col" className="is-numeric">{t('Cháy Fn12')}</th>
                <th scope="col" className="is-numeric">{t('Rút #1 (U / C)')}</th>
                <th scope="col" className="is-numeric">{t('EV/phí (24T)')}</th>
                <th scope="col">{t('Nút thắt chính')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                const isSelected = selectedRow?.schedule_id === row.schedule_id
                const meta = SCHEDULE_DISPLAY_META[row.schedule_id]
                const isT5 = row.schedule_id === 'T5_MAX_THROTTLE_YOLO'
                return (
                  <tr
                    key={row.schedule_id}
                    className={`is-actionable ${isSelected ? 'is-selected' : ''}`}
                    aria-selected={isSelected}
                    tabIndex={0}
                    data-testid={`pf-w5-row-${row.schedule_id}`}
                    onClick={() => setScheduleId(row.schedule_id)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setScheduleId(row.schedule_id)
                      }
                    }}
                  >
                    <td>
                      <div className="pf-w5-inline-badges">
                        <span className="pf-acct-id">{row.schedule_id}</span>
                        {isT5 && (
                          <span className="pf-pill is-danger" data-testid="pf-w5-t5-row-badge">
                            <span className="pf-dot" aria-hidden="true" />
                            <span>{t('Rủi ro Gambling')}</span>
                          </span>
                        )}
                      </div>
                      <span className="pf-acct-meta">
                        P1 {meta?.p1_mult}x · P2 {meta?.p2_mult}x · Fn {meta?.funded_mult}x
                      </span>
                    </td>
                    <td><GradePill grade={row.overall_grade} language={language} /></td>
                    <td className="is-numeric">
                      <div>{formatWave5Pct(row.p1_pass_12m_pct, 1)} / {formatWave5Pct(row.p1_fail_12m_pct, 1)} / {formatWave5Pct(row.p1_pending_12m_pct, 1)}</div>
                      <span className="pf-acct-meta">{gradeLabel(row.phase_grades.p1, language)}</span>
                    </td>
                    <td className="is-numeric">
                      <div>{formatWave5Pct(row.p2_pass_12m_pct, 1)} / {formatWave5Pct(row.p2_fail_12m_pct, 1)} / {formatWave5Pct(row.p2_pending_12m_pct, 1)}</div>
                      <span className="pf-acct-meta">{gradeLabel(row.phase_grades.p2, language)}</span>
                    </td>
                    <td className="is-numeric">
                      <div>{formatWave5Pct(row.pass_eval_12m_pct, 1)} / {formatWave5Pct(row.fail_eval_12m_pct, 1)} / {formatWave5Pct(row.pending_eval_12m_pct, 1)}</div>
                      <span className="pf-acct-meta">{gradeLabel(row.phase_grades.pass_eval, language)}</span>
                    </td>
                    <td className="is-numeric">
                      <div>{formatWave5Pct(row.fn12_blowup_pct)}</div>
                      <span className="pf-acct-meta">{gradeLabel(row.phase_grades.funded_12m, language)}</span>
                    </td>
                    <td className="is-numeric">
                      <div>{formatWave5Number(row.uncond_med_pay1_cap730, 1)}d</div>
                      <span className="pf-acct-meta">{formatWave5Number(row.cond_med_pay1_days, 1)}d</span>
                    </td>
                    <td className="is-numeric">
                      <div>{formatWave5Number(row.ev_per_fee_npv24, 2)}x</div>
                      <span className="pf-acct-meta">{formatWave5CompactVnd(row.ev_npv_24m_vnd, language)}</span>
                    </td>
                    <td>
                      <span className="pf-mono">{row.top_bottlenecks[0] || '—'}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Wave 4 vs Wave 5 Paired 162-Cell Comparison */}
      <section className="pf-section" aria-labelledby="pf-w5-compare-title" data-testid="pf-w5-w4-compare">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-w5-compare-title">{t('Đối chiếu Đợt 4 và Đợt 5 (Ghép cặp 162 ô ngân sách)')}</h2>
            <span className="pf-pill is-neutral" data-testid="pf-w5-legacy-unknown-pill">
              <span className="pf-dot" aria-hidden="true" />
              <span>{language === 'en' ? LEGACY_W4_P1_P2_LABEL_EN : LEGACY_W4_P1_P2_LABEL_VI}</span>
            </span>
          </div>
        </div>

        <p className="pf-w5-note">
          {t('So sánh Đợt 4 (C10_NEWS_ON, Funded 1.25x, 81 ô/mức ma sát) với Đợt 5 (T1–T5 + Bellman DP, Funded 1.0x cố định). Toàn bộ 162/162 ô ghép cặp của Đợt 5 giảm cháy Funded 12T.')}
        </p>

        <div className="wm-table-scroll pf-table-wrap" data-scroll-axis="x">
          <table className="wm-data-table" data-testid="pf-w5-compare-table">
            <thead>
              <tr>
                <th scope="col">{t('Đợt / Hồ sơ')}</th>
                <th scope="col" className="is-numeric">{t('Ô đạt Tốt / Đủ dùng / Xấu')}</th>
                <th scope="col" className="is-numeric">{t('Cháy Fn12 TB')}</th>
                <th scope="col" className="is-numeric">{t('Rút #1 TB (ngày)')}</th>
                <th scope="col" className="is-numeric">{t('Cháy vốn 36T')}</th>
                <th scope="col" className="is-numeric">{t('Trung vị ròng 36T')}</th>
                <th scope="col" className="is-numeric">{t('Chênh lệch vs Đợt 4 (162 ô)')}</th>
              </tr>
            </thead>
            <tbody>
              {w4BaselineRow && (
                <tr data-testid="pf-w5-compare-w4-row">
                  <td>
                    <span className="pf-acct-id">Wave 4 · {w4BaselineRow.profile_id}</span>
                    <span className="pf-acct-meta">Fn {w4BaselineRow.funded_mult}x · {frictionMult.toFixed(1)}x</span>
                  </td>
                  <td className="is-numeric">
                    {w4BaselineRow.grades.GOOD} / {w4BaselineRow.grades.ADEQUATE} / {w4BaselineRow.grades.BAD}
                  </td>
                  <td className="is-numeric">{formatWave5Pct(w4BaselineRow.mean_fn12_blowup_pct, 3)}</td>
                  <td className="is-numeric">{formatWave5Number(w4BaselineRow.mean_uncond_pay1_days, 1)}d</td>
                  <td className="is-numeric">{formatWave5Pct(w4BaselineRow.mean_ruin_36m_pct, 2)}</td>
                  <td className="is-numeric">{formatWave5CompactVnd(w4BaselineRow.med_of_med36m_vnd, language)}</td>
                  <td className="is-numeric">{t('Mốc gốc Đợt 4')}</td>
                </tr>
              )}
              {w5FleetRows.map(row => {
                const delta = pairedDeltasByProfile.get(row.profile_id)
                return (
                  <tr key={row.profile_id} data-testid={`pf-w5-compare-${row.profile_id}`}>
                    <td>
                      <span className="pf-acct-id">Wave 5 · {row.profile_id}</span>
                      <span className="pf-acct-meta">Fn {row.funded_mult}x · {frictionMult.toFixed(1)}x</span>
                    </td>
                    <td className="is-numeric">
                      {row.grades.GOOD} / {row.grades.ADEQUATE} / {row.grades.BAD}
                    </td>
                    <td className="is-numeric">{formatWave5Pct(row.mean_fn12_blowup_pct, 3)}</td>
                    <td className="is-numeric">{formatWave5Number(row.mean_uncond_pay1_days, 1)}d</td>
                    <td className="is-numeric">{formatWave5Pct(row.mean_ruin_36m_pct, 2)}</td>
                    <td className="is-numeric">{formatWave5CompactVnd(row.med_of_med36m_vnd, language)}</td>
                    <td className="is-numeric">
                      {delta
                        ? `${delta.delta_uncond_pay1_days > 0 ? '+' : ''}${formatWave5Number(delta.delta_uncond_pay1_days, 1)}d · Fn12 ${formatWave5Number(delta.delta_fn12_blowup_pp, 2)}pp`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
