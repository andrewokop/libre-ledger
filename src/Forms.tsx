import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  Cloud,
  LogIn,
  Trash2,
  X
} from 'lucide-react'
import { availableLots } from './domain'
import {
  expiredOn,
  expiryLabel,
  settingsFor,
  today,
  type Allocation,
  type Model,
  type Purchase,
  type Sale,
  type WriteOff,
  type Workspace
} from './types'
import { Amount } from './ui'

export function ModalShell({
  children,
  onClose
}: {
  children: ReactNode
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const container = box.current
    const focusable = () =>
      Array.from(
        container?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled):not([type=hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
        ) ?? []
      )
    const initialFocus =
      container?.querySelector<HTMLElement>(
        'input:not([type=hidden]), select'
      ) ?? focusable()[0]
    initialFocus?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (
        !(document.activeElement instanceof HTMLElement) ||
        !elements.includes(document.activeElement)
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('keydown', key)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={box}
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {children}
      </div>
    </div>
  )
}

export function FormError({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (message) ref.current?.focus()
  }, [message])
  return message ? (
    <div className="form-error" role="alert" tabIndex={-1} ref={ref}>
      {message}
    </div>
  ) : null
}

function ExpiryInput({
  value,
  onChange,
  name
}: {
  value: string
  onChange: (value: string) => void
  name?: string
}) {
  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        placeholder="ДД-ММ-ГГГГ"
        pattern="[0-9]{2}-[0-9]{2}-[0-9]{4}"
        title="Дата в формате ДД-ММ-ГГГГ"
        maxLength={10}
        value={
          /^\d{4}-\d{2}(-\d{2})?$/.test(value) ? expiryLabel(value) : value
        }
        onChange={(event) => {
          const formatted = event.target.value
            .replace(/\D/g, '')
            .slice(0, 8)
            .replace(/^(\d{2})(\d)/, '$1-$2')
            .replace(/^(\d{2}-\d{2})(\d)/, '$1-$2')
          onChange(formatted.replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$2-$1'))
        }}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </>
  )
}

export function EntryForm({
  type,
  models,
  workspace,
  entry,
  initialModelId,
  initialPurchaseId,
  error,
  onSubmit,
  onClose,
  onToggle,
  onDelete
}: {
  type: 'purchase' | 'sale' | 'writeoff'
  models: Model[]
  workspace: Workspace
  entry?: Purchase | Sale | WriteOff
  initialModelId?: string
  initialPurchaseId?: string
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const purchase = type === 'purchase',
    writeoff = type === 'writeoff'
  const [modelId, setModelId] = useState(
    entry?.modelId ?? initialModelId ?? models[0]?.id ?? ''
  )
  const [date, setDate] = useState(entry?.date ?? today())
  const [quantity, setQuantity] = useState(String(entry?.quantity ?? 1))
  const [price, setPrice] = useState(
    entry && 'unitPrice' in entry
      ? String(entry.unitPrice)
      : type === 'sale' &&
          models.find((m) => m.id === (initialModelId ?? models[0]?.id))
            ?.salePrice !== undefined
        ? String(
            models.find((m) => m.id === (initialModelId ?? models[0]?.id))
              ?.salePrice
          )
        : ''
  )
  const extra = entry && 'extra' in entry ? entry.extra : 0
  const [rows, setRows] = useState([{ quantity: '1', expiry: '' }])
  const [expiryDate, setExpiryDate] = useState(
    entry && 'expiry' in entry ? (entry.expiry ?? '') : ''
  )
  const ref =
    entry && !purchase
      ? { type: type as 'sale' | 'writeoff', id: entry.id }
      : undefined
  const lots = purchase ? [] : availableLots(workspace, modelId, date, ref)
  function proposeLots(
    nextModel: string,
    nextDate: string,
    nextQuantity: string
  ): Allocation[] {
    let left = Number(nextQuantity)
    if (!Number.isSafeInteger(left) || left < 1) return []
    const mode = settingsFor(workspace).lotSelection
    const available = availableLots(workspace, nextModel, nextDate, ref).filter(
      (l) => l.remaining > 0
    )
    const preferred =
      !entry && nextModel === initialModelId
        ? available.find((l) => l.purchase.id === initialPurchaseId)
        : undefined
    const result: Allocation[] = []
    if (preferred) {
      const count = Math.min(left, preferred.remaining)
      result.push({ purchaseId: preferred.purchase.id, quantity: count })
      left -= count
    }
    if (mode === 'manual') return result
    const candidates = available.filter(
      (l) =>
        l.purchase.id !== preferred?.purchase.id &&
        (writeoff || !expiredOn(l.purchase.expiry, nextDate))
    )
    if (writeoff || mode === 'fifo')
      candidates.sort(
        (a, b) =>
          a.purchase.date.localeCompare(b.purchase.date) ||
          a.purchase.id.localeCompare(b.purchase.id)
      )
    for (const lot of candidates) {
      if (!left) break
      const count = Math.min(left, lot.remaining)
      result.push({ purchaseId: lot.purchase.id, quantity: count })
      left -= count
    }
    return result
  }
  const [allocations, setAllocations] = useState<Allocation[]>(() => {
    if (entry && 'allocations' in entry && entry.allocations)
      return entry.allocations
    if (entry || purchase) return []
    return type === 'sale' && !initialPurchaseId ? [] : proposeLots(modelId, date, quantity)
  })
  function propose(nextModel: string, nextDate: string, nextQuantity: string) {
    setAllocations(proposeLots(nextModel, nextDate, nextQuantity))
  }
  const available = lots.reduce((sum, lot) => sum + lot.remaining, 0)
  const allocatedQuantity = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0)
  const totalQuantity =
    type === 'sale' ? allocatedQuantity : purchase && !entry && rows.length > 1
      ? rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)
      : Number(quantity)
  const total = totalQuantity * Number(price) + (purchase ? extra : 0)
  const title =
    `${entry ? 'Изменить' : 'Новая'} ${purchase ? 'закупку' : writeoff ? 'списание' : 'продажу'}`
      .replace('Новая закупку', 'Новая закупка')
      .replace('Новая продажу', 'Новая продажа')
      .replace('Новая списание', 'Новое списание')
  return (
    <form onSubmit={onSubmit}>
      <div className="modal-topline">
        <span
          className={`modal-icon ${purchase ? 'modal-buy-icon' : 'modal-sale-icon'}`}
        >
          {purchase ? <ArrowDownLeft size={25} /> : <ArrowUpRight size={25} />}
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X size={23} />
        </button>
      </div>
      <h2 id="modal-title">{title}</h2>
      {entry?.status === 'cancelled' && (
        <p className="modal-desc">Операция отменена.</p>
      )}
      <label className="form-label">
        Модель
        <select
          name="modelId"
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value)
            if (writeoff) propose(e.target.value, date, quantity)
            if (type === 'sale') setAllocations([])
            if (!entry && type === 'sale')
              setPrice(
                models
                  .find((m) => m.id === e.target.value)
                  ?.salePrice?.toString() ?? ''
              )
          }}
          required
        >
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <span className="field-chevron">
          <ChevronDown size={18} />
        </span>
      </label>
      <label className="form-label">
        {purchase
          ? 'Дата закупки'
          : writeoff
            ? 'Дата списания'
            : 'Дата продажи'}
        <input
          name="date"
          type="date"
          min="2000-01-01"
          max={today()}
          value={date}
          onChange={(e) => {
            setDate(e.target.value)
            if (writeoff) propose(modelId, e.target.value, quantity)
            if (type === 'sale') setAllocations([])
          }}
          required
        />
      </label>
      <div className="form-row">
        {type !== 'sale' && <label className="form-label">
          Количество, шт.
          <input
            name="quantity"
            type="number"
            inputMode="numeric"
            min="1"
            max="100000000"
            step="1"
            value={
              purchase && !entry && rows.length > 1 ? totalQuantity : quantity
            }
            onChange={(e) => {
              setQuantity(e.target.value)
              if (!purchase) propose(modelId, date, e.target.value)
            }}
            readOnly={purchase && !entry && rows.length > 1}
            required
          />
        </label>}
        {type === 'sale' && <input type="hidden" name="quantity" value={totalQuantity} />}
        {!writeoff && (
          <label className="form-label">
            Цена за штуку, ₽
            <input
              name="unitPrice"
              type="number"
              inputMode="decimal"
              min="0"
              max="100000000"
              step="0.01"
              placeholder="Укажите цену"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </label>
        )}
      </div>
      {purchase ? (
        <>
          <input type="hidden" name="extra" value={extra} />
          {entry ? (
            <label className="form-label">
              Годен до <span className="optional-label">необязательно</span>
              <ExpiryInput
                name="expiry"
                value={expiryDate}
                onChange={setExpiryDate}
              />
            </label>
          ) : (
            <div className="lot-picker">
              <strong>Сроки партий</strong>
              {rows.map((row, index) => (
                <div className="lot-row" key={index}>
                  <label>
                    Количество
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={rows.length === 1 ? quantity : row.quantity}
                      onChange={(e) => {
                        const next = rows.map((r, i) =>
                          i === index ? { ...r, quantity: e.target.value } : r
                        )
                        setRows(next)
                        if (rows.length === 1) setQuantity(e.target.value)
                      }}
                      required
                    />
                  </label>
                  <label>
                    Годен до
                    <ExpiryInput
                      value={row.expiry}
                      onChange={(expiry) =>
                        setRows(
                          rows.map((r, i) =>
                            i === index ? { ...r, expiry } : r
                          )
                        )
                      }
                    />
                  </label>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => {
                        const next = rows.filter((_, i) => i !== index)
                        setRows(next)
                        if (next.length === 1) setQuantity(next[0].quantity)
                      }}
                    >
                      Убрать
                    </button>
                  )}
                </div>
              ))}
              <span className="field-help">Срок указывать необязательно.</span>
              <button
                type="button"
                className="text-link"
                onClick={() =>
                  setRows([
                    ...(rows.length === 1 ? [{ ...rows[0], quantity }] : rows),
                    { quantity: '1', expiry: '' }
                  ])
                }
              >
                + Добавить срок
              </button>
              <input type="hidden" name="expiry" value={rows[0].expiry} />
              {rows.length > 1 && (
                <input
                  type="hidden"
                  name="purchases"
                  value={JSON.stringify(
                    rows.map((r) => ({
                      quantity: Number(r.quantity),
                      expiry: r.expiry
                    }))
                  )}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="availability-note">
            <Boxes size={18} />
            <span>
              Доступно: <strong>{available} шт.</strong>.
            </span>
          </p>
          <div className="lot-picker">
            <strong>Партии для {writeoff ? 'списания' : 'продажи'}</strong>
            {entry &&
              type === 'sale' &&
              !('allocations' in entry && entry.allocations) && (
                <p>
                  Исторические партии не подтверждены. Выберите фактически
                  использованные партии для сверки.
                </p>
              )}
            {lots.some((l) => l.estimated) && (
              <p>
                Остатки отдельных партий оценочные: есть продажи без
                подтверждённых партий.
              </p>
            )}
            {lots.filter((lot) => lot.remaining > 0 || allocations.some((allocation) => allocation.purchaseId === lot.purchase.id)).map(({ purchase: lot, remaining }) => (
              <label className="allocation-row" key={lot.id}>
                <span>
                  {expiryLabel(lot.expiry)}
                  {expiredOn(lot.expiry, date)
                    ? ' · просрочено на дату операции'
                    : ''}{' '}
                  {writeoff && <>· закупка {lot.date} </>}· доступно {remaining}{' '}
                  шт.
                </span>
                <input
                  aria-label={`Количество из партии ${expiryLabel(lot.expiry)}${writeoff ? ` от ${lot.date}` : ''}`}
                  type="number"
                  min="0"
                  max={remaining}
                  step="1"
                  value={
                    allocations.find((a) => a.purchaseId === lot.id)
                      ?.quantity ?? ''
                  }
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setAllocations([
                      ...allocations.filter((a) => a.purchaseId !== lot.id),
                      ...(n > 0 ? [{ purchaseId: lot.id, quantity: n }] : [])
                    ])
                  }}
                />
              </label>
            ))}
            {type === 'sale' && (
              <div className="allocation-total" aria-live="polite">
                <span>Итого: {allocatedQuantity} шт.</span>
                <div className="cost-preview">
                  <span>Сумма продажи</span>
                  <strong>{price === '' ? 'Укажите цену' : <Amount value={Number.isFinite(total) ? total : 0} />}</strong>
                </div>
              </div>
            )}
            <input
              type="hidden"
              name="allocations"
              value={JSON.stringify(allocations)}
            />
          </div>
          {writeoff && (
            <label className="form-label">
              Причина
              <input
                name="reason"
                maxLength={200}
                defaultValue={entry && 'reason' in entry ? entry.reason : ''}
                required
              />
            </label>
          )}
        </>
      )}
      <label className="form-label">
        Комментарий <span className="optional-label">необязательно</span>
        <textarea
          name="note"
          maxLength={500}
          rows={2}
          defaultValue={entry?.note ?? ''}
        />
      </label>
      {purchase && (
        <div className="cost-preview" aria-live="polite">
          <span>{purchase ? 'Закупка с доставкой' : 'Сумма продажи'}</span>
          <strong>
            {price === '' ? (
              'Укажите цену'
            ) : (
              <Amount value={Number.isFinite(total) ? total : 0} />
            )}
          </strong>
        </div>
      )}
      <FormError message={error} />
      {entry && (
        <div className="record-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onToggle}
          >
            {entry.status === 'cancelled'
              ? 'Восстановить операцию'
              : 'Отменить операцию'}
          </button>
          <button
            type="button"
            className="button button-danger-quiet"
            onClick={onDelete}
          >
            <Trash2 size={18} />
            Удалить
          </button>
        </div>
      )}
      <div className="modal-actions">
        <button className="button button-quiet" type="button" onClick={onClose}>
          Закрыть
        </button>
        <button className="button button-primary" type="submit">
          <Check size={19} />
          {entry ? 'Сохранить изменения' : 'Добавить операцию'}
        </button>
      </div>
    </form>
  )
}

export function ModelForm({
  model,
  error,
  onSubmit,
  onClose
}: {
  model?: Model
  error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}) {
  const palette = [
    ['#526df4', 'Синий'],
    ['#d66a16', 'Оранжевый'],
    ['#c89b16', 'Жёлтый'],
    ['#c83e48', 'Красный'],
    ['#ba3480', 'Розовый'],
    ['#7944c6', 'Фиолетовый'],
    ['#008ca8', 'Бирюзовый'],
    ['#64748b', 'Графитовый']
  ]
  const colors =
    model && !palette.some(([value]) => value === model.color)
      ? [...palette, [model.color, 'Текущий цвет']]
      : palette
  return (
    <form onSubmit={onSubmit}>
      <div className="modal-topline">
        <span className="modal-icon modal-sale-icon">
          <Boxes size={24} />
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X size={23} />
        </button>
      </div>
      <h2 id="modal-title">{model ? 'Изменить модель' : 'Новая модель'}</h2>
      <label className="form-label">
        Название
        <input
          name="name"
          maxLength={120}
          defaultValue={model?.name ?? ''}
          placeholder="Название вашего товара"
          required
          autoFocus
        />
      </label>
      <label className="form-label">
        Цена продажи по умолчанию, ₽{' '}
        <span className="optional-label">необязательно</span>
        <input
          name="salePrice"
          type="number"
          min="0"
          max="100000000"
          step="0.01"
          defaultValue={model?.salePrice ?? ''}
        />
      </label>
      <fieldset className="model-palette">
        <legend>Цвет модели</legend>
        <div className="palette-options">
          {colors.map(([value, label]) => (
            <label className="palette-option" key={value}>
              <input
                type="radio"
                name="color"
                value={value}
                defaultChecked={value === (model?.color ?? palette[0][0])}
                required
              />
              <span
                className="palette-swatch"
                style={{ background: value }}
                aria-hidden="true"
              >
                <Check size={19} strokeWidth={3} />
              </span>
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <FormError message={error} />
      <div className="modal-actions">
        <button className="button button-quiet" type="button" onClick={onClose}>
          Закрыть
        </button>
        <button className="button button-primary" type="submit">
          <Check size={19} />
          {model ? 'Сохранить изменения' : 'Добавить модель'}
        </button>
      </div>
    </form>
  )
}

export function ConfirmForm({
  title,
  description,
  label,
  busy,
  error,
  onConfirm,
  onClose
}: {
  title: string
  description: string
  label: string
  busy: boolean
  error: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div>
      <div className="modal-topline">
        <span className="modal-icon modal-buy-icon">
          <Trash2 size={24} />
        </span>
        <button
          className="icon-button"
          onClick={onClose}
          disabled={busy}
          aria-label="Закрыть"
        >
          <X size={23} />
        </button>
      </div>
      <h2 id="modal-title">{title}</h2>
      <p className="modal-desc">{description}</p>
      <FormError message={error} />
      <div className="modal-actions">
        <button
          className="button button-quiet"
          onClick={onClose}
          disabled={busy}
        >
          Оставить
        </button>
        <button
          className="button button-danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Сохраняем…' : label}
        </button>
      </div>
    </div>
  )
}

export function LoginForm({
  configured,
  mode,
  setMode,
  onSubmit,
  onClose,
  busy,
  onPasswordReset
}: {
  configured: boolean
  mode: 'login' | 'register'
  setMode: (mode: 'login' | 'register') => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  busy: boolean
  onPasswordReset?: (email: string) => void
}) {
  if (!configured)
    return (
      <div>
        <div className="modal-topline">
          <span className="modal-icon modal-sale-icon">
            <Cloud size={19} />
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Закрыть"
          >
            <X size={19} />
          </button>
        </div>
        <h2 id="modal-title">Сначала подключите Firebase</h2>
        <p className="modal-desc">
          Для синхронизации бесплатно создайте проект Firebase, включите
          Email/Password в Authentication и Firestore. Значения Web App добавьте
          в `.env.local` по образцу `.env.example`.
        </p>
        <div className="setup-steps">
          <span>1. Создайте проект на firebase.google.com</span>
          <span>2. Включите вход Email/Password и Firestore</span>
          <span>3. Скопируйте конфигурацию Web App в `.env.local`</span>
          <span>4. Для GitHub Actions добавьте эти же значения в Secrets</span>
        </div>
        <div className="modal-actions">
          <button className="button button-primary" onClick={onClose}>
            Понятно
          </button>
        </div>
      </div>
    )
  return (
    <form onSubmit={onSubmit}>
      <div className="modal-topline">
        <span className="modal-icon modal-sale-icon">
          <Cloud size={19} />
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X size={19} />
        </button>
      </div>
      <h2 id="modal-title">
        {mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'}
      </h2>
      <p className="modal-desc">
        Для доступа используйте разрешённый аккаунт. При регистрации потребуется
        подтвердить email.
      </p>
      <label className="form-label">
        Электронная почта
        <input
          name="email"
          type="email"
          placeholder="Введите email"
          autoComplete="email"
          required
        />
      </label>
      <label className="form-label">
        Пароль
        <input
          name="password"
          type="password"
          placeholder="Не менее 8 символов"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'register' ? 8 : 6}
          required
        />
      </label>
      {mode === 'login' && onPasswordReset && (
        <button
          className="text-link"
          type="button"
          disabled={busy}
          onClick={(event) => {
            const form = event.currentTarget.form
            if (form)
              onPasswordReset(String(new FormData(form).get('email') ?? ''))
          }}
        >
          Забыли пароль?
        </button>
      )}
      <button
        className="mode-toggle"
        type="button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login'
          ? 'Впервые здесь? Создать аккаунт'
          : 'Уже есть аккаунт? Войти'}
      </button>
      <div className="modal-actions">
        <button className="button button-quiet" type="button" onClick={onClose}>
          Отмена
        </button>
        <button className="button button-primary" type="submit" disabled={busy}>
          <LogIn size={16} />
          {mode === 'login' ? 'Войти и синхронизировать' : 'Создать аккаунт'}
        </button>
      </div>
    </form>
  )
}
