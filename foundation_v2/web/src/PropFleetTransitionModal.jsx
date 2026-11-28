import React from 'react'
import AppIcon from './AppIcon.jsx'
import LegacyModal from './LegacyModal.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import {
  PRESET_MODE_EVAL_P1_SPRINT,
  PRESET_MODE_EVAL_P2_SPRINT,
  PRESET_MODE_FUNDED_1X,
  PRESET_MODE_NONE,
  STATE_SHORT_META,
  STATE_TONES,
  sha256Hex,
} from './propFleetModel.js'

function ModalStatePill({ state, language }) {
  const tone = STATE_TONES[state] || 'neutral'
  const meta = STATE_SHORT_META[state] || { code: state, vi: state, en: state }
  const label = language === 'en' ? meta.en : meta.vi
  return (
    <span className={`pf-pill is-${tone}`} data-state-code={meta.code}>
      <span className="pf-dot" aria-hidden="true" />
      <span>{meta.code} · {label}</span>
    </span>
  )
}

export default function PropFleetTransitionModal({
  theme,
  modalAccount,
  modalTargetState,
  modalAllowedTargets,
  modalIsFundedEntry,
  modalFlatRequired,
  modalError,
  modalOpenPos,
  modalPresetMode,
  modalPresetName,
  modalPresetSha,
  modalOps5Sha,
  modalPayoutGross,
  modalEquity,
  modalTradingDays,
  modalOps2Pass,
  modalFlatConfirm,
  transitionsCount,
  onClose,
  onSubmit,
  onTargetStateChange,
  onOpenPosChange,
  onPresetModeChange,
  onPresetNameChange,
  onPresetShaChange,
  onOps5ShaChange,
  onPayoutGrossChange,
  onEquityChange,
  onTradingDaysChange,
  onOps2PassChange,
  onFlatConfirmChange,
}) {
  const { t, language } = useTestingLocale()
  if (!modalAccount) return null

  return (
    <LegacyModal
      theme={theme}
      label={t('Chuyển pha tài khoản {account}', { account: modalAccount.account_id })}
      className="pf-modal"
      onClose={onClose}
    >
      <form className="pf-modal-body" data-testid="pf-transition-modal" onSubmit={onSubmit}>
        <div className="pf-modal-context">
          <ModalStatePill state={modalAccount.state} language={language} />
          <span aria-hidden="true">→</span>
          {modalTargetState && <ModalStatePill state={modalTargetState} language={language} />}
        </div>

        {modalIsFundedEntry && (
          <div className="pf-alert is-warning" role="status">
            <AppIcon name="shield" size={16} />
            <div className="pf-alert-body">
              {t('CỔNG 2 KHÓA BẮT BUỘC: Bắt buộc 0 vị thế mở, OPS-2 PASS, preset FUNDED_1X (cấm mọi .set Eval/Sprint) và SHA-256 hợp lệ.')}
            </div>
          </div>
        )}

        {modalError && (
          <div className="pf-alert is-danger" role="alert" data-testid="pf-modal-error">
            <AppIcon name="error" size={16} />
            <div className="pf-alert-body">
              <span className="pf-alert-code">[{modalError.code}]</span>
              <span>{modalError.message}</span>
            </div>
          </div>
        )}

        <div className="pf-field-grid">
          <label className="pf-field is-full">
            <span>{t('Pha đích')}</span>
            <select
              value={modalTargetState}
              onChange={event => onTargetStateChange(event.target.value)}
              data-testid="pf-modal-target-state"
            >
              {modalAllowedTargets.map(target => {
                const m = STATE_SHORT_META[target]
                return (
                  <option key={target} value={target}>
                    {m.code} · {language === 'en' ? m.en : m.vi}
                  </option>
                )
              })}
            </select>
          </label>

          <label className="pf-field">
            <span>{t('Số vị thế đang mở (open_positions)')}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={modalOpenPos}
              onChange={event => onOpenPosChange(event.target.value)}
              data-testid="pf-modal-open-positions"
            />
          </label>

          <label className="pf-field">
            <span>{t('Chế độ preset')}</span>
            <select
              value={modalPresetMode}
              onChange={event => onPresetModeChange(event.target.value)}
              data-testid="pf-modal-preset-mode"
            >
              <option value={PRESET_MODE_NONE}>NONE</option>
              <option value={PRESET_MODE_FUNDED_1X}>FUNDED_1X</option>
              <option value={PRESET_MODE_EVAL_P1_SPRINT}>EVAL_P1_SPRINT_4_5X</option>
              <option value={PRESET_MODE_EVAL_P2_SPRINT}>EVAL_P2_SPRINT_3_5X</option>
            </select>
          </label>

          <label className="pf-field is-full">
            <span>{t('Tên tệp .set (preset_name)')}</span>
            <input
              type="text"
              value={modalPresetName}
              onChange={event => onPresetNameChange(event.target.value)}
              placeholder="FTMO_Swing10K_Funded_Safe_1x.set"
              data-testid="pf-modal-preset-name"
            />
          </label>

          <label className="pf-field is-full">
            <span>{t('Mã băm SHA-256 của tệp .set (64 ký tự hex)')}</span>
            <div className="pf-sha-row">
              <input
                type="text"
                className="pf-mono"
                value={modalPresetSha}
                onChange={event => onPresetShaChange(event.target.value)}
                placeholder="64 lowercase hex characters"
                data-testid="pf-modal-preset-sha"
              />
              <button
                type="button"
                className="wm-button"
                data-testid="pf-modal-fill-sha"
                onClick={() => onPresetShaChange(sha256Hex(`${modalAccount.account_id}:${modalPresetMode}:${modalPresetName || 'preset'}`))}
              >
                {t('Tạo SHA mẫu')}
              </button>
            </div>
          </label>

          {modalTargetState === 'S6_PAYOUT_AUDIT_AND_HARVEST' && (
            <label className="pf-field is-full">
              <span>{t('Mã băm gói kiểm toán OPS-5 (64 ký tự hex)')}</span>
              <div className="pf-sha-row">
                <input
                  type="text"
                  className="pf-mono"
                  value={modalOps5Sha}
                  onChange={event => onOps5ShaChange(event.target.value)}
                  data-testid="pf-modal-ops5-sha"
                />
                <button
                  type="button"
                  className="wm-button"
                  onClick={() => onOps5ShaChange(sha256Hex(`${modalAccount.account_id}:ops5:${transitionsCount + 1}`))}
                >
                  {t('Tạo SHA mẫu')}
                </button>
              </div>
            </label>
          )}

          {modalTargetState === 'S7_AFTER_PAYOUT_ALLOCATOR' && (
            <label className="pf-field is-full">
              <span>{t('Lợi nhuận rút gộp (USD)')}</span>
              <input
                type="number"
                min={1}
                step="0.01"
                value={modalPayoutGross}
                onChange={event => onPayoutGrossChange(event.target.value)}
                data-testid="pf-modal-payout-gross"
              />
            </label>
          )}

          {(modalTargetState === 'S2_PASS_P1_HANDOFF' || modalTargetState === 'S4_PASS_P2_TO_FUNDED_LOCK') && (
            <>
              <label className="pf-field">
                <span>{t('Equity chốt pha (USD)')}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={modalEquity}
                  onChange={event => onEquityChange(event.target.value)}
                  data-testid="pf-modal-equity"
                />
              </label>
              <label className="pf-field">
                <span>{t('Số ngày giao dịch đã đạt')}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={modalTradingDays}
                  onChange={event => onTradingDaysChange(event.target.value)}
                  data-testid="pf-modal-trading-days"
                />
              </label>
            </>
          )}
        </div>

        <div className="pf-checks">
          <label className="pf-check-label">
            <input
              type="checkbox"
              checked={modalOps2Pass}
              onChange={event => onOps2PassChange(event.target.checked)}
              data-testid="pf-modal-ops2-pass"
            />
            <span>{t('Xác nhận đã chạy tiền kiểm OPS-2 (ops2_preflight_pass = true)')}</span>
          </label>
          {modalFlatRequired && (
            <label className="pf-check-label">
              <input
                type="checkbox"
                checked={modalFlatConfirm}
                onChange={event => onFlatConfirmChange(event.target.checked)}
                data-testid="pf-modal-flat-confirm"
              />
              <span>{t('Xác nhận tài khoản phẳng lệnh hoàn toàn (open_positions == 0)')}</span>
            </label>
          )}
        </div>

        <div className="pf-modal-actions">
          <button
            type="button"
            className="wm-button"
            onClick={onClose}
          >
            {t('Hủy')}
          </button>
          <button type="submit" className="wm-button is-primary" data-testid="pf-modal-submit">
            {t('Xác nhận ghi bản nháp')}
          </button>
        </div>
      </form>
    </LegacyModal>
  )
}
