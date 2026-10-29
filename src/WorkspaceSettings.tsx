import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  Cloud,
  Download,
  FileUp,
  LogIn,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { AuthUser } from './firebase'
import type { LedgerState } from './ledgerStore'
import { parseBackup } from './domain'
import {
  DEFAULT_SETTINGS,
  settingsFor,
  type LedgerSettings,
  type Workspace
} from './types'
import { derive } from './accounting'
import { Amount } from './ui'
import { FormError } from './Forms'

export function WorkspaceSettings({
  user,
  state,
  syncLabel,
  onLogin,
  onLogout,
  onExport,
  onImport,
  onReset,
  onRetry,
  onSave,
  onPasswordReset,
  onEdit,
  onMigrationBackup
}: {
  user: AuthUser | null
  state: LedgerState
  syncLabel: string
  onLogin: () => void
  onLogout: () => void
  onExport: () => void
  onImport: (workspace: Workspace) => void
  onReset: () => void
  onRetry: () => void
  onSave?: (settings: LedgerSettings) => Promise<void> | void
  onPasswordReset?: () => void
  onEdit?: (ref: { type: 'sale'; id: string }) => void
  onMigrationBackup?: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(() => settingsFor(state.workspace))
  const [dirty, setDirty] = useState(false)
  const owner = useRef(state.uid)
  const [confirmBackup, setConfirmBackup] = useState(false)
  const [saved, setSaved] = useState('')
  const prefKey = `libre-appearance:${state.uid ?? 'guest'}`
  const [font, setFont] = useState('large')
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (owner.current !== state.uid) {
      owner.current = state.uid
      setDirty(false)
      setDraft(settingsFor(state.workspace))
      setConfirmBackup(false)
    } else if (!dirty) setDraft(settingsFor(state.workspace))
  }, [state.workspace.settings, state.uid, dirty])
  function applyAppearance(
    nextFont: string,
    nextReduced: boolean,
    persist = true
  ) {
    setFont(nextFont)
    setReduced(nextReduced)
    document.documentElement.dataset.fontSize = nextFont
    document.documentElement.dataset.reducedMotion = String(nextReduced)
    if (persist) {
      try {
        localStorage.setItem(
          prefKey,
          JSON.stringify({ font: nextFont, reduced: nextReduced })
        )
      } catch {
        /* session preference remains applied */
      }
    }
    window.dispatchEvent(new Event('libre-appearance'))
  }
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(prefKey) ?? '{}')
      applyAppearance(p.font ?? 'large', !!p.reduced, false)
    } catch {
      applyAppearance('large', false, false)
    }
  }, [prefKey])
  const current = settingsFor(state.workspace)
  const stale = dirty && draft.version !== current.version
  const changingMethod = draft.costingMethod !== current.costingMethod
  useEffect(() => {
    if (changingMethod) setConfirmBackup(false)
  }, [
    state.workspace.purchases,
    state.workspace.sales,
    state.workspace.writeOffs
  ])
  const unassigned = state.workspace.sales.filter(
    (s) => s.status !== 'cancelled' && !s.allocations
  ).length
  const before = derive(state.workspace)
  let after: ReturnType<typeof derive> | null = null
  try {
    after = derive({ ...state.workspace, settings: draft })
  } catch {
    /* Reconciliation is required before an exact preview. */
  }
  const update = <K extends keyof LedgerSettings>(
    key: K,
    value: LedgerSettings[K]
  ) => {
    setDirty(true)
    setSaved('')
    setDraft((d) => ({ ...d, [key]: value }))
  }
  async function saveSettings() {
    try {
      setError('')
      await onSave?.(draft)
      setDirty(false)
      setSaved('Настройки сохранены.')
      setConfirmBackup(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не удалось сохранить настройки.'
      )
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    try {
      if (selected.size > 3_000_000)
        throw new Error('Файл слишком большой. Максимум — 3 МБ.')
      const workspace = parseBackup(JSON.parse(await selected.text()))
      setError('')
      onImport(workspace)
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Не удалось прочитать файл.'
      )
    }
  }
  return (
    <div className="settings-grid">
      <section className="panel settings-panel settings-wide">
        <h2>Настройки учёта</h2>
        <div className="settings-fields">
          <label className="form-label">
            Название магазина
            <input
              maxLength={60}
              value={draft.storeName}
              onChange={(e) => update('storeName', e.target.value)}
            />
          </label>
          <label className="form-label">
            Начальная страница
            <select
              value={draft.homePage}
              onChange={(e) =>
                update('homePage', e.target.value as LedgerSettings['homePage'])
              }
            >
              <option value="overview">Главная</option>
              <option value="inventory">Склад</option>
              <option value="history">Операции</option>
              <option value="settings">Настройки</option>
            </select>
          </label>
          <label className="form-label">
            Главный показатель
            <select
              value={draft.primaryMetric}
              onChange={(e) =>
                update(
                  'primaryMetric',
                  e.target.value as LedgerSettings['primaryMetric']
                )
              }
            >
              <option value="profit">Прибыль</option>
              <option value="revenue">Продажи</option>
              <option value="investments">Закупки</option>
              <option value="stockValue">На складе</option>
            </select>
          </label>
          <label className="form-label">
            Период графика
            <select
              value={draft.chartMonths}
              onChange={(e) =>
                update('chartMonths', Number(e.target.value) as 1 | 3 | 6)
              }
            >
              <option value="1">1 месяц</option>
              <option value="3">3 месяца</option>
              <option value="6">6 месяцев</option>
            </select>
          </label>
          <label className="form-label">
            График по умолчанию
            <select
              value={draft.chartUnit}
              onChange={(e) =>
                update('chartUnit', e.target.value as 'rub' | 'quantity')
              }
            >
              <option value="rub">Рубли</option>
              <option value="quantity">Штуки</option>
            </select>
          </label>
          <label className="form-label">
            Предупреждать о сроке за дней
            <input
              type="number"
              min="0"
              max="730"
              value={draft.expiryWarningDays}
              onChange={(e) =>
                update('expiryWarningDays', Number(e.target.value))
              }
            />
          </label>
          <label className="form-label">
            Низкий остаток, шт.
            <input
              type="number"
              min="0"
              max="1000000"
              value={draft.lowStockThreshold}
              onChange={(e) =>
                update('lowStockThreshold', Number(e.target.value))
              }
            />
          </label>
          <label className="form-label">
            Предлагать партии
            <select
              value={draft.lotSelection}
              onChange={(e) =>
                update(
                  'lotSelection',
                  e.target.value as LedgerSettings['lotSelection']
                )
              }
            >
              <option value="fefo">Ближайший срок</option>
              <option value="fifo">Сначала ранние закупки</option>
              <option value="manual">Вручную</option>
            </select>
          </label>
        </div>
        <details className="settings-advanced">
          <summary>Метод расчёта прибыли</summary>
          <label className="form-label">
            Себестоимость
            <select
              value={draft.costingMethod}
              onChange={(e) => {
                update(
                  'costingMethod',
                  e.target.value as LedgerSettings['costingMethod']
                )
                setConfirmBackup(false)
              }}
            >
              <option value="average">Средняя стоимость модели</option>
              <option value="lot">Стоимость выбранных партий</option>
            </select>
          </label>
          {changingMethod && (
            <>
              <p>
                Изменение пересчитает всю историю. Сравните показатели и
                скачайте резервную копию.
              </p>
              {unassigned > 0 && (
                <div className="reconciliation-list">
                  <p>
                    Продаж без подтверждённых партий: {unassigned}. Укажите
                    фактические партии для каждой продажи.
                  </p>
                  {state.workspace.sales
                    .filter((s) => s.status !== 'cancelled' && !s.allocations)
                    .map((s) => (
                      <div key={s.id}>
                        <span>
                          {state.workspace.models.find(
                            (m) => m.id === s.modelId
                          )?.name ?? 'Модель'}{' '}
                          · {s.date} · {s.quantity} шт.
                        </span>
                        <button
                          className="text-link"
                          disabled={!onEdit}
                          onClick={() => onEdit?.({ type: 'sale', id: s.id })}
                        >
                          Сверить
                        </button>
                      </div>
                    ))}
                </div>
              )}
              {!after && (
                <p>
                  Предварительный расчёт пока недоступен. Сначала завершите
                  сверку операций.
                </p>
              )}
              {after && (
                <div className="method-comparison">
                  <span>
                    Прибыль: <Amount value={before.profit} /> →{' '}
                    <Amount value={after.profit} />
                  </span>
                  <span>
                    Стоимость выбытия: <Amount value={before.cogs} /> →{' '}
                    <Amount value={after.cogs} />
                  </span>
                  <span>
                    Остаток: <Amount value={before.stockValue} /> →{' '}
                    <Amount value={after.stockValue} />
                  </span>
                </div>
              )}
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={confirmBackup}
                  onChange={(e) => setConfirmBackup(e.target.checked)}
                />{' '}
                Я скачал резервную копию и подтверждаю пересчёт истории
              </label>
            </>
          )}
        </details>
        {stale && (
          <p role="alert">
            Настройки изменились на другом устройстве. Ваши правки сохранены в
            форме; отмените их и проверьте новые значения перед сохранением.
          </p>
        )}
        <FormError message={error} />
        {saved && <p role="status">{saved}</p>}
        <div className="settings-buttons">
          <button
            className="button button-primary"
            disabled={
              !onSave ||
              !state.ready ||
              state.busy ||
              stale ||
              (changingMethod && (!confirmBackup || unassigned > 0 || !after))
            }
            onClick={() => {
              void saveSettings()
            }}
          >
            Сохранить настройки
          </button>
          <button
            className="button button-quiet"
            onClick={() => {
              setDraft(current)
              setDirty(false)
              setConfirmBackup(false)
              setSaved('Несохранённые изменения отменены.')
            }}
          >
            Отменить изменения
          </button>
          <button
            className="button button-quiet"
            disabled={!state.ready || state.busy}
            onClick={() => {
              setDraft({
                ...DEFAULT_SETTINGS,
                version: draft.version,
                costingMethod: draft.costingMethod
              })
              setDirty(true)
              setConfirmBackup(false)
              setSaved(
                'Значения восстановлены. Сохраните настройки, чтобы применить их.'
              )
            }}
          >
            Восстановить настройки по умолчанию
          </button>
        </div>
        <p>Сброс настроек не удаляет операции и модели.</p>
      </section>
      <section className="panel settings-panel">
        <h2>Внешний вид на этом устройстве</h2>
        <label className="form-label">
          Размер текста
          <select
            value={font}
            onChange={(e) => applyAppearance(e.target.value, reduced)}
          >
            <option value="normal">Обычный</option>
            <option value="large">Крупный</option>
            <option value="xlarge">Очень крупный</option>
          </select>
        </label>
        <label className="settings-check">
          <input
            type="checkbox"
            checked={reduced}
            onChange={(e) => applyAppearance(font, e.target.checked)}
          />{' '}
          Уменьшить анимацию
        </label>
      </section>
      <section className="panel settings-panel">
        <h2>Сохранение и аккаунт</h2>
        <p>
          {user
            ? 'Локальная копия и облако привязаны к вашему аккаунту. Изменения отправляются только после ваших действий.'
            : 'Учёт сохраняется в этом браузере. Войдите, чтобы открыть свой облачный учёт на другом устройстве. Локальные записи не переносятся в аккаунт автоматически.'}
        </p>
        <div className="settings-status">
          <span className="settings-status-icon">
            {user ? <Cloud size={22} /> : <ShieldCheck size={22} />}
          </span>
          <span>
            <strong>{syncLabel}</strong>
            <small>
              {state.pending
                ? `Ожидают отправки: ${state.pending}`
                : user
                  ? 'Проверяйте этот статус перед сменой устройства.'
                  : 'Для работы без облака регистрация не нужна.'}
            </small>
            {user && state.lastConfirmedAt && (
              <small>
                Последняя подтверждённая синхронизация:{' '}
                {new Intl.DateTimeFormat('ru-RU', {
                  dateStyle: 'short',
                  timeStyle: 'short'
                }).format(state.lastConfirmedAt)}
              </small>
            )}
          </span>
        </div>
        {user ? (
          <div className="settings-buttons">
            {onPasswordReset && (
              <button className="button button-quiet" onClick={onPasswordReset}>
                Сбросить пароль
              </button>
            )}
            <button
              className="button button-quiet"
              onClick={onRetry}
              disabled={state.busy}
            >
              <RefreshCw size={18} />
              Синхронизировать
            </button>
            <button
              className="button button-quiet"
              onClick={onLogout}
              disabled={state.busy}
            >
              <LogOut size={18} />
              Выйти
            </button>
          </div>
        ) : (
          <button className="button button-primary" onClick={onLogin}>
            <LogIn size={19} />
            Войти в аккаунт
          </button>
        )}
      </section>
      <section className="panel settings-panel">
        <h2>Резервная копия</h2>
        <p>
          Скачайте учёт в JSON. При восстановлении проверим модели, даты, суммы
          и остатки до замены данных. Импорт заменяет текущий учёт целиком.
        </p>
        <div className="settings-buttons">
          <button className="button button-primary" onClick={onExport}>
            <Download size={19} />
            Скачать копию
          </button>
          {onMigrationBackup && (
            <button className="button button-quiet" onClick={onMigrationBackup}>
              <Download size={19} />
              Скачать копию до обновления
            </button>
          )}
          <button
            className="button button-quiet"
            onClick={() => file.current?.click()}
            disabled={state.busy}
          >
            <FileUp size={19} />
            Восстановить
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            void readFile(event)
          }}
          hidden
          aria-label="Файл резервной копии"
        />
        <FormError message={error} />
      </section>
      <section className="panel settings-panel danger-zone">
        <h2>Очистить весь учёт</h2>
        <p>
          Удаляются все модели, закупки, продажи и отменённые операции{' '}
          {user
            ? 'этого аккаунта в облаке и на устройстве'
            : 'из локального учёта'}
          . Рабочий учёт станет пустым. Архив перед обновлением сохраняется
          отдельно.
        </p>
        <button
          className="button button-danger-quiet"
          disabled={!state.ready || state.busy}
          onClick={onReset}
        >
          <Trash2 size={19} />
          Очистить весь учёт
        </button>
      </section>
    </div>
  )
}
