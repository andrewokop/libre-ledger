import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, Boxes, Check, ChevronDown, Cloud, LogIn, Trash2, X } from 'lucide-react'
import { availableForSale } from './domain'
import { isActive, today, type Model, type Purchase, type Sale, type Workspace } from './types'
import { Amount } from './ui'

export function ModalShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const container = box.current
    const focusable = () => Array.from(container?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])
    const initialFocus = container?.querySelector<HTMLElement>('input, select') ?? focusable()[0]
    initialFocus?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = previousOverflow; previousFocus?.focus() }
  }, [])
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><div ref={box} className="modal-box" role="dialog" aria-modal="true" aria-labelledby="modal-title">{children}</div></div>
}

export function FormError({ message }: { message: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (message) ref.current?.focus() }, [message])
  return message ? <div className="form-error" role="alert" tabIndex={-1} ref={ref}>{message}</div> : null
}

export function EntryForm({ type, models, workspace, entry, error, onSubmit, onClose, onToggle, onDelete }: {
  type: 'purchase' | 'sale'; models: Model[]; workspace: Workspace; entry?: Purchase | Sale; error: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; onToggle: () => void; onDelete: () => void
}) {
  const purchase = type === 'purchase'
  const [modelId, setModelId] = useState(entry?.modelId ?? models[0]?.id ?? '')
  const [date, setDate] = useState(entry?.date ?? today())
  const [quantity, setQuantity] = useState(String(entry?.quantity ?? 1))
  const [price, setPrice] = useState(entry ? String(entry.unitPrice) : '')
  const [extra, setExtra] = useState(entry && 'extra' in entry ? String(entry.extra) : '0')
  const available = availableForSale(workspace, modelId, date, purchase ? undefined : entry?.id)
  const enforceStock = !purchase && isActive(entry ?? {})
  const total = Number(quantity) * Number(price) + (purchase ? Number(extra) : 0)
  const title = entry ? purchase ? 'Изменить закупку' : 'Изменить продажу' : purchase ? 'Новая закупка' : 'Новая продажа'
  return <form onSubmit={onSubmit}>
    <div className="modal-topline"><span className={`modal-icon ${purchase ? 'modal-buy-icon' : 'modal-sale-icon'}`}>{purchase ? <ArrowDownLeft size={25} /> : <ArrowUpRight size={25} />}</span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={23} /></button></div>
    <h2 id="modal-title">{title}</h2><p className="modal-desc">{entry?.status === 'cancelled' ? 'Операция отменена и не участвует в расчётах.' : 'После сохранения остатки и прибыль пересчитаются.'}</p>
    <label className="form-label">Модель<select name="modelId" value={modelId} onChange={(event) => setModelId(event.target.value)} required>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="field-chevron"><ChevronDown size={18} /></span></label>
    <label className="form-label">Дата<input name="date" type="date" min="2000-01-01" max={today()} value={date} onChange={(event) => setDate(event.target.value)} required /></label>
    <div className="form-row"><label className="form-label">Количество, шт.<span className="quantity-input"><button type="button" aria-label="Уменьшить количество" disabled={Number(quantity) <= 1} onClick={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}>−</button><input name="quantity" aria-label="Количество, шт." type="number" inputMode="numeric" min="1" max={enforceStock ? available : 100000000} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /><button type="button" aria-label="Увеличить количество" disabled={enforceStock && Number(quantity) >= available} onClick={() => setQuantity(String(Number(quantity) + 1))}>+</button></span></label><label className="form-label">Цена за штуку, ₽<input name="unitPrice" type="number" inputMode="decimal" min="0" max="100000000" step="0.01" placeholder="0" value={price} onChange={(event) => setPrice(event.target.value)} required /></label></div>
    {purchase ? <label className="form-label">Доставка и расходы, ₽<input name="extra" type="number" inputMode="decimal" min="0" max="100000000" step="0.01" value={extra} onChange={(event) => setExtra(event.target.value)} /><span className="field-help">Включаются в себестоимость товара</span></label> : <p className="availability-note"><Boxes size={18} /><span>Можно продать: <strong>{available} шт.</strong> с учётом следующих продаж.</span></p>}
    <label className="form-label">Комментарий <span className="optional-label">необязательно</span><textarea name="note" maxLength={500} rows={2} defaultValue={entry?.note ?? ''} placeholder="Например, клиент, доставка или причина исправления" /></label>
    <div className="cost-preview" aria-live="polite"><span>{purchase ? 'Закупка с доставкой' : 'Сумма продажи'}</span><strong><Amount value={Number.isFinite(total) ? total : 0} /></strong></div>
    <FormError message={error} />
    {entry && <div className="record-actions"><button type="button" className="button button-quiet" onClick={onToggle}>{entry.status === 'cancelled' ? 'Восстановить операцию' : 'Отменить операцию'}</button><button type="button" className="button button-danger-quiet" onClick={onDelete}><Trash2 size={18} />Удалить</button></div>}
    <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Закрыть</button><button className="button button-primary" type="submit"><Check size={19} />{entry ? 'Сохранить изменения' : purchase ? 'Добавить закупку' : 'Записать продажу'}</button></div>
  </form>
}

export function ModelForm({ model, error, onSubmit, onClose }: { model?: Model; error: string; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const colors = [['#526df4', 'Синий'], ['#f5a66b', 'Абрикосовый'], ['#a493eb', 'Фиолетовый'], ['#75b7ee', 'Голубой'], ['#bd83cf', 'Сиреневый']]
  return <form onSubmit={onSubmit}><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Boxes size={24} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={23} /></button></div><h2 id="modal-title">{model ? 'Изменить модель' : 'Новая модель'}</h2><p className="modal-desc">Название и цвет изменятся во всех связанных записях.</p><label className="form-label">Название<input name="name" maxLength={120} defaultValue={model?.name ?? ''} placeholder="Название вашего товара" required autoFocus /></label><label className="form-label">Цвет<select name="color" defaultValue={model?.color ?? colors[0][0]}>{model && !colors.some(([value]) => value === model.color) && <option value={model.color}>Текущий цвет</option>}{colors.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><span className="field-chevron"><ChevronDown size={18} /></span></label><FormError message={error} /><div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Закрыть</button><button className="button button-primary" type="submit"><Check size={19} />{model ? 'Сохранить изменения' : 'Добавить модель'}</button></div></form>
}

export function ConfirmForm({ title, description, label, busy, error, onConfirm, onClose }: { title: string; description: string; label: string; busy: boolean; error: string; onConfirm: () => void; onClose: () => void }) {
  return <div><div className="modal-topline"><span className="modal-icon modal-buy-icon"><Trash2 size={24} /></span><button className="icon-button" onClick={onClose} disabled={busy} aria-label="Закрыть"><X size={23} /></button></div><h2 id="modal-title">{title}</h2><p className="modal-desc">{description}</p><FormError message={error} /><div className="modal-actions"><button className="button button-quiet" onClick={onClose} disabled={busy}>Оставить</button><button className="button button-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Сохраняем…' : label}</button></div></div>
}

export function LoginForm({ configured, mode, setMode, onSubmit, onClose, busy }: { configured: boolean; mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; busy: boolean }) {
  if (!configured) return <div><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Cloud size={19} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><h2 id="modal-title">Сначала подключите Firebase</h2><p className="modal-desc">Для синхронизации бесплатно создайте проект Firebase, включите Email/Password в Authentication и Firestore. Значения Web App добавьте в `.env.local` по образцу `.env.example`.</p><div className="setup-steps"><span>1. Создайте проект на firebase.google.com</span><span>2. Включите вход Email/Password и Firestore</span><span>3. Скопируйте конфигурацию Web App в `.env.local`</span><span>4. Для GitHub Actions добавьте эти же значения в Secrets</span></div><div className="modal-actions"><button className="button button-primary" onClick={onClose}>Понятно</button></div></div>
  return <form onSubmit={onSubmit}><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Cloud size={19} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><h2 id="modal-title">{mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'}</h2><p className="modal-desc">Для доступа используйте разрешённый аккаунт. При регистрации потребуется подтвердить email.</p><label className="form-label">Электронная почта<input name="email" type="email" placeholder="Введите email" autoComplete="email" required /></label><label className="form-label">Пароль<input name="password" type="password" placeholder="Не менее 8 символов" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : 6} required /></label><button className="mode-toggle" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Впервые здесь? Создать аккаунт' : 'Уже есть аккаунт? Войти'}</button><div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit" disabled={busy}><LogIn size={16} />{mode === 'login' ? 'Войти и синхронизировать' : 'Создать аккаунт'}</button></div></form>
}
