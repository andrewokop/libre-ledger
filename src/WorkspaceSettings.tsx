import { useRef, useState, type ChangeEvent } from 'react'
import { Cloud, Download, FileUp, LogIn, LogOut, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import type { AuthUser } from './firebase'
import type { LedgerState } from './ledgerStore'
import { parseBackup } from './domain'
import type { Workspace } from './types'
import { FormError } from './Forms'

export function WorkspaceSettings({ user, state, syncLabel, onLogin, onLogout, onExport, onImport, onReset, onRetry }: {
  user: AuthUser | null; state: LedgerState; syncLabel: string; onLogin: () => void; onLogout: () => void; onExport: () => void; onImport: (workspace: Workspace) => void; onReset: () => void; onRetry: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    event.target.value = ''
    if (!selected) return
    try {
      if (selected.size > 1_000_000) throw new Error('Файл слишком большой. Максимум — 1 МБ.')
      const workspace = parseBackup(JSON.parse(await selected.text()))
      setError(''); onImport(workspace)
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось прочитать файл.') }
  }
  return <div className="settings-grid">
    <section className="panel settings-panel"><h2>Сохранение и аккаунт</h2><p>{user ? 'Локальная копия и облако привязаны к вашему аккаунту. Изменения отправляются только после ваших действий.' : 'Учёт сохраняется в этом браузере. Войдите, чтобы открыть свой облачный учёт на другом устройстве. Локальные записи не переносятся в аккаунт автоматически.'}</p><div className="settings-status"><span className="settings-status-icon">{user ? <Cloud size={22} /> : <ShieldCheck size={22} />}</span><span><strong>{syncLabel}</strong><small>{state.pending ? `Ожидают отправки: ${state.pending}` : user ? 'Проверяйте этот статус перед сменой устройства.' : 'Для работы без облака регистрация не нужна.'}</small></span></div>{user ? <div className="settings-buttons"><button className="button button-quiet" onClick={onRetry} disabled={state.busy}><RefreshCw size={18} />Синхронизировать</button><button className="button button-quiet" onClick={onLogout} disabled={state.busy}><LogOut size={18} />Выйти</button></div> : <button className="button button-primary" onClick={onLogin}><LogIn size={19} />Войти в аккаунт</button>}</section>
    <section className="panel settings-panel"><h2>Резервная копия</h2><p>Скачайте учёт в JSON. При восстановлении проверим модели, даты, суммы и остатки до замены данных. Импорт заменяет текущий учёт целиком.</p><div className="settings-buttons"><button className="button button-primary" onClick={onExport}><Download size={19} />Скачать копию</button><button className="button button-quiet" onClick={() => file.current?.click()} disabled={state.busy}><FileUp size={19} />Восстановить</button></div><input ref={file} type="file" accept=".json,application/json" onChange={(event) => { void readFile(event) }} hidden aria-label="Файл резервной копии" /><FormError message={error} /></section>
    <section className="panel settings-panel method-panel"><h2>Как устроен учёт</h2><p>Каждая модель имеет свой остаток и среднюю закупочную стоимость с учётом доставки. Отменённые операции остаются в истории и не влияют на расчёты. Изменения прошлых дат проверяются вместе со всеми следующими продажами.</p><p>Сайт не требует платной подписки и не использует платные функции Firebase. Для облака достаточно Spark; бесплатные квоты провайдера ограничены. В рабочем пространстве доступно до 100 моделей и 3000 операций, объём данных проверяется перед сохранением.</p></section>
    <section className="panel settings-panel danger-zone"><h2>Очистить весь учёт</h2><p>Удаляются все модели, закупки, продажи и отменённые операции {user ? 'этого аккаунта в облаке и на устройстве' : 'из локального учёта'}. Предустановленных моделей после очистки не будет.</p><button className="button button-danger-quiet" disabled={!state.ready || state.busy} onClick={onReset}><Trash2 size={19} />Очистить весь учёт</button></section>
  </div>
}
