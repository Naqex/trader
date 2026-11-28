import React, { useMemo, useState } from 'react'
import AppIcon from './AppIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { WAVE5_ALPHA_BENCH_SNAPSHOT } from './propFleetWave5Fixture.js'
import {
  formatWave5Number,
  formatWave5Pct,
  validateAlphaBenchSnapshot,
} from './propFleetWave5Model.js'
import './prop-fleet-wave5.css'

const PROPOSAL_LABELS = {
  RETIRE_AND_SWAP: {
    vi: 'Diễn tập 3 · Thay thế E6 bằng B1',
    en: 'Drill 3 · Retire E6 & Swap B1',
  },
  REDUCE_WEIGHT_AMBER: {
    vi: 'Diễn tập 2 · Hạ 0.5x E3 (Amber)',
    en: 'Drill 2 · Reduce E3 to 0.5x (Amber)',
  },
  HALT_ONLY_EMPTY_BENCH: {
    vi: 'Diễn tập 4 · Dừng E6 khi Bench trống',
    en: 'Drill 4 · Halt-Only Empty Bench',
  },
}

function diffLineClass(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'pf-w5-diff-line is-hdr'
  if (line.startsWith('+')) return 'pf-w5-diff-line is-add'
  if (line.startsWith('-')) return 'pf-w5-diff-line is-del'
  return 'pf-w5-diff-line'
}

export default function PropFleetAlphaBenchPanel() {
  const { t, language } = useTestingLocale()
  const [selectedProposalId, setSelectedProposalId] = useState(
    () => WAVE5_ALPHA_BENCH_SNAPSHOT.proposals[0]?.proposal_id || '',
  )

  const validation = useMemo(() => validateAlphaBenchSnapshot(WAVE5_ALPHA_BENCH_SNAPSHOT), [])

  const selectedProposal = useMemo(
    () => WAVE5_ALPHA_BENCH_SNAPSHOT.proposals.find(p => p.proposal_id === selectedProposalId)
      || WAVE5_ALPHA_BENCH_SNAPSHOT.proposals[0]
      || null,
    [selectedProposalId],
  )

  const { port_v5_status: portV5, alpha_bench_reserve: reserve, hard_invariants: inv } = WAVE5_ALPHA_BENCH_SNAPSHOT

  return (
    <div className="pf-w5-stack" data-testid="pf-w5-alpha-bench-panel">
      {!validation.ok && (
        <div className="pf-alert is-danger" role="alert" data-testid="pf-w5-alpha-error">
          <AppIcon name="error" size={16} />
          <div className="pf-alert-body">
            <span className="pf-alert-code">[{validation.code}]</span>
            <span>{validation.message}</span>
          </div>
        </div>
      )}

      {/* Honest PORT_V5 == PORT_7E Disclosure & Governance Lock Banner */}
      <div className="pf-alert is-warning" role="status" data-testid="pf-w5-portv5-disclosure">
        <AppIcon name="shield" size={16} />
        <div className="pf-alert-body">
          <span className="pf-alert-code">[PORT_V5 == PORT_7E · auto_deploy = false]</span>
          <span>
            {t('Công bố trung thực: 0/{trials} ứng viên M1 mới vượt trọn 8/8 cổng Cluster B khắt khe (BH-FDR, DSR, PBO, Sharpe, Chi phí 2x, N >= 60, Trực giao, Swap = 0). Danh mục cốt lõi giữ nguyên 7 động cơ PORT_7E đã kiểm chứng; mọi đề xuất thay thế chỉ ở chế độ xem trước chờ chủ sở hữu phê duyệt.', {
              trials: portV5.m1_trials_evaluated,
            })}
          </span>
        </div>
      </div>

      {/* Closed-Loop Alpha Factory KPI Strip */}
      <section className="pf-kpi-strip" aria-label={t('Tổng quan Nhà máy Alpha khép kín')} data-testid="pf-w5-alpha-kpis">
        <div className="pf-kpi-cell">
          <span className="pf-kpi-label">
            <AppIcon name="layers" size={14} />
            {t('Động cơ cốt lõi PORT_7E')}
          </span>
          <strong className="pf-kpi-value">{portV5.n_core7_engines} / 7</strong>
          <span className="pf-kpi-sub">
            PORT_V5 == PORT_7E · {t('Tổng rủi ro nền')} {formatWave5Pct(portV5.total_base_risk_pct)} · Shield A {formatWave5Pct(inv.shield_a_total_open_cap_pct)}
          </span>
        </div>

        <div className="pf-kpi-cell">
          <span className="pf-kpi-label">
            <AppIcon name="search" size={14} />
            {t('Đấu trường M1 Wave 5')}
          </span>
          <strong className="pf-kpi-value">0 / {portV5.m1_trials_evaluated}</strong>
          <span className="pf-kpi-sub">
            {t('{finalists} vào chung kết Cluster B · 1 Dự bị chẩn đoán · {killed} bị loại', {
              finalists: portV5.finalists_evaluated,
              killed: portV5.killed_on_cluster_b_count,
            })}
          </span>
        </div>

        <div className="pf-kpi-cell">
          <span className="pf-kpi-label">
            <AppIcon name="list-checks" size={14} />
            {t('Diễn tập E2E suy thoái & thay thế')}
          </span>
          <strong className="pf-kpi-value">
            {WAVE5_ALPHA_BENCH_SNAPSHOT.drills_passed} / {WAVE5_ALPHA_BENCH_SNAPSHOT.drills_total} PASS
          </strong>
          <span className="pf-kpi-sub">
            W5-G16 & W5-G17 · {t('8/8 dữ liệu đầu độc & băm giả bị chặn cứng')}
          </span>
        </div>

        <div className="pf-kpi-cell">
          <span className="pf-kpi-label">
            <AppIcon name="lock" size={14} />
            {t('Khóa quản trị triển khai')}
          </span>
          <strong className="pf-kpi-value">auto_deploy = false</strong>
          <span className="pf-kpi-sub">
            OrderSend = {inv.order_send_count} · Holdout {inv.holdout_cutoff_date} SEALED
          </span>
        </div>
      </section>

      {/* 7 Active PORT_7E Engines + CUSUM / SPRT Monitor Status */}
      <section className="pf-section" aria-labelledby="pf-w5-core7-title">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-w5-core7-title">{t('7 Động cơ PORT_7E đang hoạt động & Trạng thái giám sát CUSUM / SPRT')}</h2>
            <p className="pf-section-sub">
              {t('Nền thật (Diễn tập 1): 7/7 động cơ GREEN_WITHIN_EXPECTATION. Cột bên phải hiển thị kết quả đo CUSUM / SPRT trong diễn tập tổng hợp Drill 3 (E6 bị tiêm suy thoái giả lập).')}
            </p>
          </div>
        </div>

        <div className="wm-table-scroll pf-table-wrap" data-scroll-axis="x">
          <table className="wm-data-table" data-testid="pf-w5-core7-table">
            <thead>
              <tr>
                <th scope="col">{t('Động cơ')}</th>
                <th scope="col">{t('Cặp / Magic')}</th>
                <th scope="col" className="is-numeric">{t('Rủi ro nền')}</th>
                <th scope="col" className="is-numeric">{t('Sharpe Cluster B')}</th>
                <th scope="col" className="is-numeric">{t('DSR / PBO')}</th>
                <th scope="col">{t('Trạng thái nền (Drill 1)')}</th>
                <th scope="col" className="is-numeric">{t('CUSUM / Cone (Drill 3)')}</th>
                <th scope="col">{t('Kết luận SPRT (Drill 3)')}</th>
              </tr>
            </thead>
            <tbody>
              {WAVE5_ALPHA_BENCH_SNAPSHOT.core_7e_engines.map(eng => {
                const isDrill3Red = eng.drill3_verdict === 'RED_HALT_ALPHA_DECAY'
                return (
                  <tr key={eng.engine_id} data-testid={`pf-w5-engine-${eng.engine_id}`}>
                    <td>
                      <span className="pf-acct-id">{eng.engine_id}</span>
                      <span className="pf-acct-meta">Dev &lt;= {eng.dev_max_date} · n={eng.dev_series_len}</span>
                    </td>
                    <td>
                      <span>{eng.symbol}</span>
                      <span className="pf-acct-meta pf-mono">{eng.magic}</span>
                    </td>
                    <td className="is-numeric">{formatWave5Pct(eng.base_risk_pct, 2)}</td>
                    <td className="is-numeric">{formatWave5Number(eng.cluster_b_sharpe, 2)}</td>
                    <td className="is-numeric">
                      {formatWave5Number(eng.dsr_empirical, 2)} / {formatWave5Number(eng.pbo_cscv, 2)}
                    </td>
                    <td>
                      <span className="pf-pill is-success">
                        <span className="pf-dot" aria-hidden="true" />
                        <span>ACTIVE_1X · GREEN</span>
                      </span>
                    </td>
                    <td className="is-numeric">
                      <div>{formatWave5Number(eng.drill3_cusum_cur_neg, 2)}σ</div>
                      <span className="pf-acct-meta">p-rank {formatWave5Pct(eng.drill3_cone_pct_rank, 1)}</span>
                    </td>
                    <td>
                      <span className={`pf-pill ${isDrill3Red ? 'is-danger' : 'is-success'}`}>
                        <span className="pf-dot" aria-hidden="true" />
                        <span>{isDrill3Red ? 'SIMULATED RED · RETIRED' : eng.drill3_sprt_state}</span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* F5D_US30_TO_UK100 ALPHA_BENCH_RESERVE Diagnostic + Cluster B Finalists */}
      <section className="pf-section" aria-labelledby="pf-w5-reserve-title">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-w5-reserve-title">{t('Hồ sơ Dự bị chẩn đoán ALPHA_BENCH_RESERVE & 6 ứng viên chung kết M1')}</h2>
            <span className="pf-pill is-warning">
              <span className="pf-dot" aria-hidden="true" />
              <span>{reserve.tier_classification} · {reserve.council_verdict}</span>
            </span>
          </div>
        </div>

        <div className="pf-w5-two-col" data-testid="pf-w5-reserve-card">
          <div className="pf-w5-panel-cell">
            <div className="pf-w5-gauge-head">
              <h3>{reserve.candidate_id}</h3>
              <span className="pf-pill is-warning">
                <span className="pf-dot" aria-hidden="true" />
                <span>{reserve.gates_passed_count}/{reserve.gates_total} {t('cổng')}</span>
              </span>
            </div>

            <p className="pf-w5-note">
              {t('Ghi chú chẩn đoán: ứng viên dẫn dắt chéo {leader} -> {symbol} có độ trực giao tốt (corr = {corr}) và chịu chi phí {cost}x, nhưng KHÔNG đạt 4/8 cổng thống kê Cluster B nên bị hội đồng từ chối nâng lên chạy thật (PORT_V5 == PORT_7E).', {
                leader: reserve.leader_symbol,
                symbol: reserve.symbol,
                corr: formatWave5Number(reserve.corr_vs_port_7e, 4),
                cost: formatWave5Number(reserve.cost_breakeven_mult, 2),
              })}
            </p>

            <dl className="pf-w5-metrics-grid">
              <div>
                <dt>Sharpe Cluster B</dt>
                <dd>{formatWave5Number(reserve.sharpe_1x_b, 4)}</dd>
              </div>
              <div>
                <dt>PF 1.0x / 2.0x</dt>
                <dd>{formatWave5Number(reserve.pf_1x_b, 3)} / {formatWave5Number(reserve.pf_2x_b, 3)}</dd>
              </div>
              <div>
                <dt>{t('Số lệnh / Hòa vốn chi phí')}</dt>
                <dd>{reserve.n_trades_b} / {formatWave5Number(reserve.cost_breakeven_mult, 2)}x</dd>
              </div>
              <div>
                <dt>{t('Tương quan / Đuôi xấu')}</dt>
                <dd>{formatWave5Number(reserve.corr_vs_port_7e, 4)} / {formatWave5Number(reserve.tail_corr_vs_port_7e, 4)}</dd>
              </div>
              <div>
                <dt>BH-FDR q (m={reserve.bh_fdr_m_total})</dt>
                <dd>{formatWave5Number(reserve.bh_fdr_q, 2)}</dd>
              </div>
              <div>
                <dt>DSR / PBO</dt>
                <dd>{formatWave5Number(reserve.dsr_empirical, 2)} / {formatWave5Number(reserve.pbo_cscv, 4)}</dd>
              </div>
              <div>
                <dt>Swap / Flat 20:50 UTC</dt>
                <dd>{formatWave5Number(reserve.swap_r_total, 1)}R · {reserve.all_flat_by_2050_utc ? 'YES' : 'NO'}</dd>
              </div>
              <div>
                <dt>{t('Chứng nhận MT5')}</dt>
                <dd className="pf-mono">{reserve.mt5_cert_status}</dd>
              </div>
            </dl>

            <div className="pf-w5-gate-pills">
              {Object.entries(reserve.gate_checks).map(([gateKey, passed]) => (
                <span key={gateKey} className={`pf-pill ${passed ? 'is-success' : 'is-danger'}`}>
                  <span className="pf-dot" aria-hidden="true" />
                  <span>{gateKey}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="pf-w5-panel-cell">
            <h3>{t('6 Ứng viên chung kết Cluster B (355 thử nghiệm M1)')}</h3>
            <div className="wm-table-scroll pf-table-wrap" data-scroll-axis="x">
              <table className="wm-data-table" data-testid="pf-w5-finalists-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Ứng viên')}</th>
                    <th scope="col" className="is-numeric">SR_B</th>
                    <th scope="col" className="is-numeric">PF_B</th>
                    <th scope="col" className="is-numeric">{t('Cổng')}</th>
                    <th scope="col">{t('Phân loại')}</th>
                  </tr>
                </thead>
                <tbody>
                  {WAVE5_ALPHA_BENCH_SNAPSHOT.cluster_b_finalists.map(cand => {
                    const isReserve = cand.tier_classification === 'ALPHA_BENCH_RESERVE'
                    return (
                      <tr key={cand.candidate_id}>
                        <td>
                          <span className="pf-acct-id">{cand.candidate_id}</span>
                          <span className="pf-acct-meta">{cand.symbol} · n={cand.n_trades_b} · corr {formatWave5Number(cand.corr_vs_port_7e, 3)}</span>
                        </td>
                        <td className="is-numeric">{formatWave5Number(cand.sharpe_1x_b, 2)}</td>
                        <td className="is-numeric">{formatWave5Number(cand.pf_1x_b, 2)}</td>
                        <td className="is-numeric">{cand.gates_passed_count}/8</td>
                        <td>
                          <span className={`pf-pill ${isReserve ? 'is-warning' : 'is-danger'}`}>
                            <span className="pf-dot" aria-hidden="true" />
                            <span>{cand.tier_classification}</span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* 5/5 E2E Decay/Swap Governance Drills */}
      <section className="pf-section" aria-labelledby="pf-w5-drills-title" data-testid="pf-w5-drills-grid">
        <div className="pf-section-head">
          <div className="pf-section-title-group">
            <h2 id="pf-w5-drills-title">{t('5/5 Kịch bản diễn tập E2E Suy thoái & Đóng an toàn (W5-G16 / W5-G17)')}</h2>
            <span className="pf-pill is-success">
              <span className="pf-dot" aria-hidden="true" />
              <span>{WAVE5_ALPHA_BENCH_SNAPSHOT.drills_verdict}</span>
            </span>
          </div>
        </div>

        <div className="wm-table-scroll pf-table-wrap" data-scroll-axis="x">
          <table className="wm-data-table" data-testid="pf-w5-drills-table">
            <thead>
              <tr>
                <th scope="col">{t('Kịch bản diễn tập')}</th>
                <th scope="col">{t('Kết quả')}</th>
                <th scope="col">{t('Tóm tắt hành vi')}</th>
                <th scope="col" className="is-numeric">{t('Sự kiện sổ cái')}</th>
                <th scope="col">{t('Mã băm gốc SHA-256')}</th>
              </tr>
            </thead>
            <tbody>
              {WAVE5_ALPHA_BENCH_SNAPSHOT.e2e_drills.map(drill => (
                <tr key={drill.drill_id} data-testid={`pf-w5-drill-${drill.drill_id}`}>
                  <td className="pf-acct-id">{drill.drill_id}</td>
                  <td>
                    <span className={`pf-pill ${drill.passed && drill.integrity_verified ? 'is-success' : 'is-danger'}`}>
                      <span className="pf-dot" aria-hidden="true" />
                      <span>{drill.passed ? 'PASS' : 'FAIL'}</span>
                    </span>
                  </td>
                  <td>{drill.summary_code}</td>
                  <td className="is-numeric">{drill.entry_count}</td>
                  <td className="pf-mono">{String(drill.ledger_root_sha256 || '').slice(0, 16)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Read-Only Retire & Swap Proposal Preview (auto_deploy = false Lock) */}
      {selectedProposal && (
        <section className="pf-section" aria-labelledby="pf-w5-proposal-title" data-testid="pf-w5-proposal-preview">
          <div className="pf-section-head">
            <div className="pf-section-title-group">
              <h2 id="pf-w5-proposal-title">{t('Xem trước Đề xuất Nghỉ hưu & Thay thế (Chỉ đọc · Khóa auto_deploy = false)')}</h2>
              <span className="pf-pill is-info" data-testid="pf-w5-autodeploy-lock">
                <AppIcon name="lock" size={13} />
                <span>auto_deploy_permitted: false · {selectedProposal.owner_approval_status}</span>
              </span>
            </div>

            <div className="pf-w5-seg-group" role="group" aria-label={t('Chọn đề xuất diễn tập')}>
              {WAVE5_ALPHA_BENCH_SNAPSHOT.proposals.map(prop => {
                const lbl = PROPOSAL_LABELS[prop.action_type]
                return (
                  <button
                    key={prop.proposal_id}
                    type="button"
                    className="pf-w5-seg-btn"
                    aria-pressed={selectedProposal.proposal_id === prop.proposal_id}
                    data-testid={`pf-w5-prop-btn-${prop.action_type}`}
                    onClick={() => setSelectedProposalId(prop.proposal_id)}
                  >
                    {lbl ? (language === 'en' ? lbl.en : lbl.vi) : prop.action_type}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="pf-w5-two-col">
            <div className="pf-w5-panel-cell">
              <div className="pf-w5-gauge-head">
                <h3 className="pf-mono">{selectedProposal.proposal_id}</h3>
                <span className="pf-pill is-warning">
                  <span className="pf-dot" aria-hidden="true" />
                  <span>{selectedProposal.action_type}</span>
                </span>
              </div>

              <dl className="pf-w5-metrics-grid">
                <div>
                  <dt>{t('Động cơ mục tiêu')}</dt>
                  <dd>{selectedProposal.target_engine_id}</dd>
                </div>
                <div>
                  <dt>{t('Động cơ thay thế')}</dt>
                  <dd>{selectedProposal.replacement_engine_id || '—'}</dd>
                </div>
                <div>
                  <dt>{t('Trạng thái sau đề xuất')}</dt>
                  <dd>{selectedProposal.replacement_state_after_proposal || 'HALT / REDUCE'}</dd>
                </div>
                <div>
                  <dt>{t('Trọng số đề xuất')}</dt>
                  <dd>{formatWave5Number(selectedProposal.proposed_weight_mult, 2)}x</dd>
                </div>
                <div>
                  <dt>auto_deploy_permitted</dt>
                  <dd>{String(selectedProposal.auto_deploy_permitted)}</dd>
                </div>
                <div>
                  <dt>approval_required</dt>
                  <dd>{String(selectedProposal.approval_required)}</dd>
                </div>
                <div>
                  <dt>InpDryRunLogOnly</dt>
                  <dd>{String(selectedProposal.draft_set_diff.dry_run_locked_true)}</dd>
                </div>
                <div>
                  <dt>proposal_sha256</dt>
                  <dd className="pf-mono">{selectedProposal.proposal_sha256.slice(0, 14)}…</dd>
                </div>
              </dl>

              {selectedProposal.decay_reasons?.length > 0 && (
                <p className="pf-w5-note">
                  <strong>{t('Lý do kích hoạt')}:</strong> {selectedProposal.decay_reasons.join(' · ')}
                </p>
              )}
              {selectedProposal.fail_closed_reason && (
                <p className="pf-w5-note">
                  <strong>{t('Lý do đóng an toàn')}:</strong> {selectedProposal.fail_closed_reason}
                </p>
              )}
            </div>

            <div className="pf-w5-panel-cell">
              <div className="pf-w5-gauge-head">
                <h3>{t('Bản nháp đối chiếu tệp .set (Chỉ đọc)')}</h3>
                <span className="pf-pill is-neutral">
                  <AppIcon name="lock" size={13} />
                  <span>DryRun = true · OrderSend = 0</span>
                </span>
              </div>
              <pre className="pf-w5-diff-box" data-testid="pf-w5-proposal-diff">
                {selectedProposal.draft_set_diff.unified_diff.split('\n').map((line, idx) => (
                  <div key={idx} className={diffLineClass(line)}>{line}</div>
                ))}
              </pre>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
