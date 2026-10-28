import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Activity, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Boxes, CalendarDays, Check, ChevronDown, Cloud, CloudOff, Download, FileDown, Filter, LayoutDashboard, LogIn, LogOut, Menu, Plus, Search, Settings2, ShieldCheck, Trash2, X } from 'lucide-react'
import { authenticate as authenticateUser, authErrorMessage, firebaseConfigured, isAllowedEmail, logout, observeAuth, saveWorkspace, subscribeWorkspace, type AuthUser } from './firebase'
import { id, initialWorkspace, money, shortDate, today, type Model, type Purchase, type Sale, type Workspace } from './types'

import { Overview } from './Overview'

type Page = 'overview' | 'inventory' | 'history' | 'settings'
type Modal = 'purchase' | 'sale' | 'model' | 'login' | null
type Movement = { id: string; type: 'purchase' | 'sale'; date: string; name: string; quantity: number; amount: number }
type LotStats = { purchase: Purchase; remaining: number; sold: number; revenue: number; cogs: number }

const STORE_KEY = 'libre-ledger-v1'
const currency = (value: number) => `${money(value)} ₽`

function loadWorkspace(key = STORE_KEY): { workspace: Workspace; isNew: boolean } {
  try {
    const saved = localStorage.getItem(key)
    if (saved) return { workspace: JSON.parse(saved) as Workspace, isNew: localStorage.getItem(`${key}-demo`) === 'true' }
  } catch { /* Use the starter workspace if saved data is unavailable. */ }
  return { workspace: initialWorkspace, isNew: true }
}

export function derive(workspace: Workspace) {
  const lots: LotStats[] = workspace.purchases.map((purchase) => ({ purchase, remaining: 0, sold: 0, revenue: 0, cogs: 0 }))
  let revenue = 0
  let cogs = 0
  const modelBalances = new Map<string, { quantity: number; value: number }>()
  const events = [
    ...workspace.purchases.map((purchase) => ({ type: 'purchase' as const, date: purchase.date, id: purchase.id, purchase })),
    ...workspace.sales.map((sale) => ({ type: 'sale' as const, date: sale.date, id: sale.id, sale })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? a.id.localeCompare(b.id) : a.type === 'purchase' ? -1 : 1))

  for (const event of events) {
    if (event.type === 'purchase') {
      const batch = event.purchase
      const purchaseLot = lots.find((item) => item.purchase.id === batch.id)
      if (purchaseLot) purchaseLot.remaining += batch.quantity
      const balance = modelBalances.get(batch.modelId) ?? { quantity: 0, value: 0 }
      balance.quantity += batch.quantity
      balance.value += batch.quantity * batch.unitPrice + batch.extra
      modelBalances.set(batch.modelId, balance)
      continue
    }
    const sale = event.sale
    const balance = modelBalances.get(sale.modelId) ?? { quantity: 0, value: 0 }
    const averageCost = balance.quantity > 0 ? balance.value / balance.quantity : 0
    const saleCogs = sale.quantity * averageCost
    const modelLots = lots.filter((lot) => lot.purchase.modelId === sale.modelId && lot.remaining > 0)
    const totalRemaining = modelLots.reduce((sum, lot) => sum + lot.remaining, 0)
    let unitsToAllocate = Math.min(sale.quantity, totalRemaining)
    const quotas = modelLots.map((lot) => ({ lot, units: totalRemaining ? Math.min(lot.remaining, unitsToAllocate * lot.remaining / totalRemaining) : 0 }))
    const allocations = quotas.map(({ lot, units }) => ({ lot, units: Math.floor(units) }))
    unitsToAllocate -= allocations.reduce((sum, item) => sum + item.units, 0)
    const remainderOrder = quotas.map(({ lot, units }, index) => ({ index, fraction: units - Math.floor(units), room: lot.remaining - allocations[index].units })).sort((a, b) => b.fraction - a.fraction)
    while (unitsToAllocate > 0) {
      const next = remainderOrder.find((item) => item.room > 0)
      if (!next) break
      allocations[next.index].units += 1
      next.room -= 1
      unitsToAllocate -= 1
    }
    for (const { lot, units } of allocations) {
      if (!units) continue
      lot.remaining -= units
      lot.sold += units
      lot.revenue += sale.unitPrice * units
      lot.cogs += averageCost * units
    }
    balance.quantity = Math.max(0, balance.quantity - sale.quantity)
    balance.value = Math.max(0, balance.value - saleCogs)
    modelBalances.set(sale.modelId, balance)
    revenue += sale.quantity * sale.unitPrice
    cogs += saleCogs
  }

  const stockValue = [...modelBalances.values()].reduce((sum, balance) => sum + balance.value, 0)
  const quantity = [...modelBalances.values()].reduce((sum, balance) => sum + balance.quantity, 0)
  const investments = workspace.purchases.reduce((sum, purchase) => sum + purchase.quantity * purchase.unitPrice + purchase.extra, 0)
  const profit = revenue - cogs
  const movementByMonth = new Map<string, { month: string; sales: number; expenses: number }>()
  for (const sale of workspace.sales) {
    const key = sale.date.slice(0, 7)
    const item = movementByMonth.get(key) ?? { month: '', sales: 0, expenses: 0 }
    item.month = new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(`${key}-15T12:00:00`)).replace('.', '')
    item.sales += sale.quantity * sale.unitPrice
    movementByMonth.set(key, item)
  }
  for (const purchase of workspace.purchases) {
    const key = purchase.date.slice(0, 7)
    const item = movementByMonth.get(key) ?? { month: '', sales: 0, expenses: 0 }
    item.month = new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(`${key}-15T12:00:00`)).replace('.', '')
    item.expenses += purchase.quantity * purchase.unitPrice + purchase.extra
    movementByMonth.set(key, item)
  }
  const chart = [...movementByMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([, value]) => value)
  const movements: Movement[] = [
    ...workspace.purchases.map((purchase) => ({ id: purchase.id, type: 'purchase' as const, date: purchase.date, name: workspace.models.find((model) => model.id === purchase.modelId)?.name ?? 'Сенсор', quantity: purchase.quantity, amount: -(purchase.quantity * purchase.unitPrice + purchase.extra) })),
    ...workspace.sales.map((sale) => ({ id: sale.id, type: 'sale' as const, date: sale.date, name: workspace.models.find((model) => model.id === sale.modelId)?.name ?? 'Сенсор', quantity: sale.quantity, amount: sale.quantity * sale.unitPrice })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const averageCosts = new Map([...modelBalances.entries()].map(([modelId, balance]) => [modelId, balance.quantity ? balance.value / balance.quantity : 0]))
  return { lots: lots.sort((a, b) => b.purchase.date.localeCompare(a.purchase.date)), revenue, cogs, stockValue, quantity, investments, profit, chart, movements, averageCosts }
}

export function availableOn(workspace: Workspace, modelId: string, date: string) {
  const events = [
    ...workspace.purchases.filter((purchase) => purchase.modelId === modelId && purchase.date <= date).map((purchase) => ({ date: purchase.date, type: 'purchase' as const, quantity: purchase.quantity })),
    ...workspace.sales.filter((sale) => sale.modelId === modelId && sale.date <= date).map((sale) => ({ date: sale.date, type: 'sale' as const, quantity: sale.quantity })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'purchase' ? -1 : 1))
  return Math.max(0, events.reduce((balance, event) => balance + (event.type === 'purchase' ? event.quantity : -event.quantity), 0))
}

function hasStockForSales(workspace: Workspace) {
  const events = [
    ...workspace.purchases.map((purchase) => ({ modelId: purchase.modelId, date: purchase.date, type: 'purchase' as const, quantity: purchase.quantity })),
    ...workspace.sales.map((sale) => ({ modelId: sale.modelId, date: sale.date, type: 'sale' as const, quantity: sale.quantity })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'purchase' ? -1 : 1))
  const balances = new Map<string, number>()
  for (const event of events) {
    const next = (balances.get(event.modelId) ?? 0) + (event.type === 'purchase' ? event.quantity : -event.quantity)
    if (next < 0) return false
    balances.set(event.modelId, next)
  }
  return true
}

const navItems: { page: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { page: 'overview', label: 'Обзор', icon: LayoutDashboard },
  { page: 'inventory', label: 'Склад и партии', icon: Boxes },
  { page: 'history', label: 'История операций', icon: ArrowLeftRight },
  { page: 'settings', label: 'Настройки', icon: Settings2 },
]

export default function App() {
  const [initial] = useState(loadWorkspace)
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace)
  const [demoMode, setDemoMode] = useState(initial.isNew)
  const [activeOwnerUid, setActiveOwnerUid] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [modal, setModal] = useState<Modal>(null)
  const [notice, setNotice] = useState('')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [syncReady, setSyncReady] = useState(false)
  const [syncedUid, setSyncedUid] = useState<string | null>(null)
  const [syncError, setSyncError] = useState('')
  const [workspaceReady, setWorkspaceReady] = useState(!initial.isNew)
  const [mobileNav, setMobileNav] = useState(false)
  const [search, setSearch] = useState('')
  const [filterModel, setFilterModel] = useState('all')
  const [loginMode, setLoginMode] = useState<'login' | 'register'>('login')
  const syncTimer = useRef<number | undefined>(undefined)
  const stats = useMemo(() => derive(workspace), [workspace])

  useEffect(() => {
    const key = activeOwnerUid ? `${STORE_KEY}-${activeOwnerUid}` : STORE_KEY
    localStorage.setItem(key, JSON.stringify(workspace))
    localStorage.setItem(`${key}-demo`, String(demoMode))
  }, [workspace, demoMode, activeOwnerUid])

  useEffect(() => {
    let unsubscribe: () => void = () => undefined
    let active = true
    void observeAuth((nextUser) => {
      setSyncedUid(null)
      setSyncError('')
      if (nextUser && (!isAllowedEmail(nextUser.email) || !nextUser.emailVerified)) {
        setUser(null)
        setSyncReady(true)
        setWorkspaceReady(true)
        setNotice(isAllowedEmail(nextUser.email)
          ? 'Подтверди email по ссылке из письма, затем войди снова.'
          : 'Этот аккаунт не разрешён для входа.')
        void logout()
        return
      }
      setUser(nextUser)
      setSyncReady(!nextUser)
      if (!nextUser) {
        setActiveOwnerUid(null)
        const guest = loadWorkspace()
        setWorkspace(guest.workspace)
        setDemoMode(guest.isNew)
        setWorkspaceReady(true)
        return
      }
      const accountWorkspace = loadWorkspace(`${STORE_KEY}-${nextUser.uid}`)
      const guestWorkspace = loadWorkspace()
      setActiveOwnerUid(nextUser.uid)
      setWorkspace(accountWorkspace.isNew
        ? guestWorkspace.isNew ? { models: initialWorkspace.models, purchases: [], sales: [] } : guestWorkspace.workspace
        : accountWorkspace.workspace)
      setDemoMode(false)
      setWorkspaceReady(false)
    }).then((stop) => { if (active) unsubscribe = stop; else stop() })
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    if (!user) return
    setSyncReady(false)
    let unsubscribe: () => void = () => undefined
    let active = true
    void subscribeWorkspace(user.uid, (remote) => {
      if (remote) {
        setWorkspace(remote)
        setDemoMode(false)
        setWorkspaceReady(true)
      } else {
        setWorkspaceReady(true)
      }
      setSyncedUid(user.uid)
      setSyncReady(true)
    }, (error) => {
      setSyncError(error.message)
      setSyncReady(true)
    }).then((stop) => { if (active) unsubscribe = stop; else stop() }).catch((error: Error) => setSyncError(error.message))
    return () => { active = false; unsubscribe() }
  }, [user])

  useEffect(() => {
    if (!user || !syncReady || !workspaceReady || syncedUid !== user.uid || syncError) return
    window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      saveWorkspace(user.uid, workspace).then(() => setSyncError('')).catch((error: Error) => setSyncError(error.message))
    }, 700)
    return () => window.clearTimeout(syncTimer.current)
  }, [workspace, user, syncReady, workspaceReady, syncedUid, syncError])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2600)
    return () => window.clearTimeout(timer)
  }, [notice])

  function addPurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const purchase: Purchase = {
      id: id(), modelId: String(data.get('modelId')), date: String(data.get('date')),
      quantity: Number(data.get('quantity')), unitPrice: Number(data.get('unitPrice')), extra: Number(data.get('extra') || 0), sold: 0,
    }
    setWorkspace((current) => ({ ...current, purchases: [...current.purchases, purchase] }))
    setDemoMode(false)
    setModal(null); setNotice('Закупка добавлена')
  }

  function addSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const sale: Sale = { id: id(), modelId: String(data.get('modelId')), date: String(data.get('date')), quantity: Number(data.get('quantity')), unitPrice: Number(data.get('unitPrice')), costBasis: 0 }
    const available = availableOn(workspace, sale.modelId, sale.date)
    if (sale.quantity > available) { setNotice(`На складе только ${available} шт.`); return }
    setWorkspace((current) => ({ ...current, sales: [...current.sales, sale] }))
    setDemoMode(false)
    setModal(null); setNotice('Продажа записана')
  }

  function deleteMovement(movement: Movement) {
    if (!window.confirm('Удалить эту запись? Склад, прибыль и окупаемость будут пересчитаны.')) return
    if (movement.type === 'purchase') {
      const next = { ...workspace, purchases: workspace.purchases.filter((item) => item.id !== movement.id) }
      if (!hasStockForSales(next)) {
        setNotice('Удаление оставит часть продаж без закупленного товара')
        return
      }
      setWorkspace(next)
    } else {
      setWorkspace((current) => ({ ...current, sales: current.sales.filter((item) => item.id !== movement.id) }))
    }
    setDemoMode(false)
    setNotice('Запись удалена, расчёты обновлены')
  }

  function addModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const model: Model = { id: id(), name: String(data.get('name')).trim(), color: String(data.get('color')) }
    if (!model.name) return
    setWorkspace((current) => ({ ...current, models: [...current.models, model] }))
    setDemoMode(false)
    setModal(null); setNotice('Модель добавлена')
  }

  function exportData() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `libre-ledger-${today()}.json`; link.click(); URL.revokeObjectURL(url)
    setNotice('Резервная копия скачана')
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email')); const password = String(data.get('password'))
    try {
      const result = await authenticateUser(email, password, loginMode === 'register')
      setModal(null)
      setNotice(result === 'verification-sent'
        ? 'Отправил письмо для подтверждения email. Подтверди адрес и затем войди.'
        : 'Вход выполнен')
    } catch (error) {
      setNotice(authErrorMessage(error))
    }
  }

  const pageTitle = navItems.find((item) => item.page === page)?.label ?? 'Обзор'
  const pageSubtitle = page === 'overview' ? 'Продажи, прибыль и запасы. Вся картина — перед вами.' : page === 'inventory' ? 'Каждая партия, её остаток и возврат вложений.' : page === 'history' ? 'Все поступления и продажи в хронологическом порядке.' : 'Ваши данные всегда под рукой.'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setPage('overview'); setMobileNav(false) }} aria-label="Libre Ledger — на главную"><span className="brand-mark"><Activity size={24} strokeWidth={2} /></span><span>libre<span className="brand-light">ledger</span><small>ПРОСТОЙ УЧЁТ. ЯСНАЯ КАРТИНА.</small></span></a>
        <div className="workspace-label"><span className="workspace-avatar">L</span><span><strong>Мой магазин</strong><small>Сенсоры FreeStyle Libre</small></span><span className="workspace-dot" /></div>
        <div className="side-section">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav className="nav-list" aria-label="Основная навигация">{navItems.map(({ page: target, label, icon: Icon }) => <button key={target} aria-current={page === target ? 'page' : undefined} className={`nav-link ${page === target ? 'nav-active' : ''}`} onClick={() => { setPage(target); setMobileNav(false) }}><Icon size={19} strokeWidth={1.7} /><span>{label}</span>{target === 'inventory' && <span className="nav-count">{stats.quantity}</span>}{target === page && target !== 'inventory' && <ArrowRight size={15} className="nav-arrow" />}</button>)}</nav>
        <div className="sidebar-message"><span className="sidebar-message-line" /><p>Меньше рутины.<br /><strong>Больше ясности.</strong></p><span>Ваш магазин — в вашем ритме.</span></div>
        <div className="sidebar-bottom">
          <div className="sync-card"><div className={`sync-icon ${user ? 'sync-good' : ''}`}>{user ? <Cloud size={17} /> : <ShieldCheck size={17} />}</div><div className="sync-copy"><strong>{user ? (syncError ? 'Нет связи с облаком' : syncReady ? 'Облако подключено' : 'Синхронизация…') : 'Сохраняется автоматически'}</strong><span>{user ? 'Личный аккаунт' : 'В этом браузере'}</span></div></div>
          <button className="profile-row" onClick={() => user ? void logout() : setModal('login')}><span className="avatar">L</span><span className="profile-copy"><strong>{user ? 'Мой аккаунт' : 'Личный кабинет'}</strong><span>{user ? 'Облачная синхронизация' : 'Войти для синхронизации'}</span></span>{user ? <LogOut size={16} /> : <ChevronDown size={16} />}</button>
        </div>
      </aside>
      {mobileNav && <button className="mobile-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNav(false)} />}

      <main className="main-area">
        <header className="topbar"><button className="mobile-menu icon-button" aria-label="Открыть меню" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="breadcrumb"><span>Рабочее пространство</span><span className="crumb-slash">/</span><strong>{pageTitle}</strong></div><div className="topbar-right"><span className="today-label"><CalendarDays size={15} />{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span><button className={`connection ${user && syncReady && !syncError ? 'connection-live' : ''}`} onClick={() => user ? setNotice(syncError ? 'Проверьте настройки Firestore' : 'Облачная синхронизация активна') : setModal('login')}><span className="connection-dot" />{user ? (syncError ? 'Нет связи' : syncReady ? 'Синхронизировано' : 'Сохраняем…') : 'Только на устройстве'}</button></div></header>
        <div className="content-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />{page === 'overview' ? 'ОБЗОР МАГАЗИНА' : 'МОЙ МАГАЗИН'}</div><h1>{page === 'overview' ? 'Всё под контролем' : pageTitle}<span className="heading-period">.</span></h1><p>{pageSubtitle}</p></div><div className="heading-actions"><button className="button button-quiet" onClick={() => setModal('purchase')}><Plus size={17} />Закупка</button><button className="button button-primary" disabled={!stats.quantity} title={!stats.quantity ? 'Сначала добавьте закупку' : undefined} onClick={() => setModal('sale')}><ArrowUpRight size={18} />Новая продажа</button></div></div>
          {demoMode && <div className="demo-banner"><span className="demo-badge">ДЕМО</span><span className="demo-copy">Здесь можно осмотреться. <span>Это пример учёта — начните свой с чистого листа.</span></span><button onClick={() => { setWorkspace((current) => ({ models: current.models, purchases: [], sales: [] })); setDemoMode(false); setNotice('Пример очищен. Можно вносить свои данные') }}>Начать свой учёт <ArrowRight size={15} /></button></div>}

          {page === 'overview' && <Overview workspace={workspace} stats={stats} onPage={setPage} onSale={() => setModal('sale')} />}
          {page === 'inventory' && <Inventory workspace={workspace} stats={stats} search={search} setSearch={setSearch} filterModel={filterModel} setFilterModel={setFilterModel} onAddModel={() => setModal('model')} />}
          {page === 'history' && <History movements={stats.movements} models={workspace.models} onDelete={deleteMovement} />}
          {page === 'settings' && <Settings user={user} configured={firebaseConfigured} syncError={syncError} onLogin={() => setModal('login')} onExport={exportData} onLogout={() => void logout()} />}
          <footer className="footer"><span>libre ledger <span className="footer-sep">/</span> Порядок в цифрах. Спокойствие в делах.</span><button onClick={exportData}><Download size={13} />Скачать резервную копию</button></footer>
        </div>
      </main>

      {modal && <ModalShell onClose={() => setModal(null)}>{modal === 'purchase' && <EntryForm type="purchase" models={workspace.models} onSubmit={addPurchase} onClose={() => setModal(null)} />}{modal === 'sale' && <EntryForm type="sale" models={workspace.models.filter((model) => stats.lots.some((lot) => lot.purchase.modelId === model.id && lot.remaining > 0))} onSubmit={addSale} onClose={() => setModal(null)} />}{modal === 'model' && <ModelForm onSubmit={addModel} onClose={() => setModal(null)} />}{modal === 'login' && <LoginForm configured={firebaseConfigured} mode={loginMode} setMode={setLoginMode} onSubmit={authenticate} onClose={() => setModal(null)} />}</ModalShell>}
      {notice && <div className="toast" role="status"><span className="toast-check"><Check size={14} /></span>{notice}<button onClick={() => setNotice('')} aria-label="Закрыть"><X size={15} /></button></div>}
    </div>
  )
}

function Inventory({ workspace, stats, search, setSearch, filterModel, setFilterModel, onAddModel }: { workspace: Workspace; stats: ReturnType<typeof derive>; search: string; setSearch: (value: string) => void; filterModel: string; setFilterModel: (value: string) => void; onAddModel: () => void }) {
  const filtered = stats.lots.filter((lot) => (filterModel === 'all' || lot.purchase.modelId === filterModel) && workspace.models.find((model) => model.id === lot.purchase.modelId)?.name.toLowerCase().includes(search.toLowerCase()))
  return <div className="page-stack"><section className="inventory-summary"><div><span>Складской запас</span><strong>{stats.quantity} <small>сенсоров</small></strong></div><i /><div><span>Себестоимость остатков</span><strong>{currency(stats.stockValue)}</strong></div><i /><div><span>Активных партий</span><strong>{stats.lots.filter((lot) => lot.remaining > 0).length}</strong></div></section><div className="panel inventory-panel"><div className="panel-head inventory-heading"><div><div className="panel-kicker">ПАРТИОННЫЙ УЧЁТ</div><h2>Все закупки</h2><p>Окупаемость рассчитывается по фактическим продажам</p></div><button className="button button-primary" onClick={onAddModel}><Plus size={16} />Новая модель</button></div><div className="filter-row"><label className="search-field"><Search size={16} /><input aria-label="Найти модель" placeholder="Найти модель…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="filter-select"><Filter size={15} /><select value={filterModel} onChange={(event) => setFilterModel(event.target.value)}><option value="all">Все модели</option>{workspace.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select><ChevronDown size={14} /></label><span className="filter-count">{filtered.length} {filtered.length === 1 ? 'партия' : 'партий'}</span></div><div className="table-scroll"><table className="data-table inventory-table"><thead><tr><th>МОДЕЛЬ И ПАРТИЯ</th><th>ПОСТУПИЛО</th><th>ОСТАЛОСЬ</th><th>СЕБЕСТОИМОСТЬ</th><th>ВЫРУЧКА</th><th>ОКУПАЕМОСТЬ</th></tr></thead><tbody>{filtered.map((lot) => { const model = workspace.models.find((item) => item.id === lot.purchase.modelId); const invested = lot.purchase.quantity * lot.purchase.unitPrice + lot.purchase.extra; const returned = invested ? lot.revenue / invested * 100 : 0; return <tr key={lot.purchase.id}><td><div className="lot-model-cell"><span className="model-marker" style={{ background: model?.color }} /><span><strong>{model?.name ?? 'Сенсор'}</strong><small>{shortDate(lot.purchase.date)} · закупка {lot.purchase.id.slice(0, 4).toUpperCase()}</small></span></div></td><td><strong className="table-primary">{lot.purchase.quantity} шт.</strong><small className="table-secondary">{shortDate(lot.purchase.date)}</small></td><td><strong className="table-primary">{lot.remaining} шт.</strong><small className="table-secondary">продано {lot.sold}</small></td><td><strong className="table-primary">{currency(lot.purchase.unitPrice + lot.purchase.extra / lot.purchase.quantity)}</strong><small className="table-secondary">{currency(invested)} всего</small></td><td><strong className="table-primary">{currency(lot.revenue)}</strong><small className="table-secondary">прибыль {currency(lot.revenue - lot.cogs)}</small></td><td><div className="payback"><div className="payback-label"><strong className={returned >= 100 ? 'paid' : ''}>{Math.round(returned)}%</strong><span>{returned >= 100 ? 'вернулось' : 'возврат вложений'}</span></div><div className="progress-track"><span style={{ width: `${Math.min(returned, 100)}%` }} /></div></div></td></tr>})}</tbody></table>{!filtered.length && <div className="empty-state"><Boxes size={26} /><strong>{stats.lots.length ? 'Ничего не найдено' : 'Пока пусто'}</strong><span>{stats.lots.length ? 'Попробуйте другое название или выберите другую модель' : 'Добавьте закупку, чтобы увидеть партии'}</span>{stats.lots.length > 0 && <button className="text-link" onClick={() => { setSearch(''); setFilterModel('all') }}>Сбросить фильтры</button>}</div>}</div><div className="inventory-note"><span><Activity size={15} />Средняя себестоимость</span><span>Продажи списываются по средней закупочной цене модели. Доставка включена в стоимость партии.</span></div></div></div>
}

function History({ movements, models, onDelete }: { movements: Movement[]; models: Model[]; onDelete: (movement: Movement) => void }) {
  return <div className="panel history-panel"><div className="panel-head"><div><div className="panel-kicker">ЖУРНАЛ ОПЕРАЦИЙ</div><h2>Все поступления и продажи</h2><p>История движения товаров и денег</p></div><span className="history-count">{movements.length} записей</span></div><div className="table-scroll"><table className="data-table history-table"><thead><tr><th>ДАТА</th><th>ОПЕРАЦИЯ</th><th>МОДЕЛЬ</th><th>КОЛИЧЕСТВО</th><th>СУММА</th><th aria-label="Действия" /></tr></thead><tbody>{movements.map((movement) => <tr key={movement.id}><td className="history-date">{shortDate(movement.date)}</td><td><span className={`type-badge ${movement.type}`}><i />{movement.type === 'sale' ? 'Продажа' : 'Закупка'}</span></td><td className="history-model">{models.find((model) => model.name === movement.name)?.name ?? movement.name}</td><td>{movement.quantity} шт.</td><td className={movement.type === 'sale' ? 'history-positive' : 'history-negative'}>{movement.type === 'sale' ? '+' : '−'}{currency(Math.abs(movement.amount))}</td><td><button className="row-delete" title="Удалить запись" aria-label={`Удалить ${movement.type === 'sale' ? 'продажу' : 'закупку'} ${movement.name}`} onClick={() => onDelete(movement)}><Trash2 size={15} /></button></td></tr>)}</tbody></table>{!movements.length && <div className="empty-state"><ArrowLeftRight size={26} /><strong>Операций пока нет</strong><span>Добавьте первую закупку или продажу</span></div>}</div></div>
}

function Settings({ user, configured, syncError, onLogin, onExport, onLogout }: { user: AuthUser | null; configured: boolean; syncError: string; onLogin: () => void; onExport: () => void; onLogout: () => void }) {
  return <div className="settings-grid"><div className="panel settings-panel"><div className="panel-kicker">ВАШИ ДАННЫЕ</div><h2>Синхронизация</h2><p>Покупки и продажи сохраняются автоматически в этом браузере. Войдите, чтобы синхронизировать рабочее пространство между своими устройствами.</p><div className={`settings-status ${user && !syncError ? 'settings-ok' : syncError ? 'settings-error' : ''}`}><span className="settings-status-icon">{syncError ? <CloudOff size={18} /> : user ? <Cloud size={18} /> : <ShieldCheck size={18} />}</span><span><strong>{syncError ? 'Требуется подключение' : user ? 'Облачное сохранение включено' : configured ? 'Облако пока не подключено' : 'Сохранение на устройстве активно'}</strong><small>{syncError || (user ? 'Аккаунт синхронизирован' : configured ? 'Войдите, чтобы включить синхронизацию' : 'Локальные данные останутся доступны без регистрации')}</small></span></div>{user ? <button className="button button-quiet" onClick={onLogout}><LogOut size={16} />Выйти из аккаунта</button> : <button className="button button-primary" onClick={onLogin}><LogIn size={16} />Подключить синхронизацию</button>}</div><div className="panel settings-panel backup-panel"><div className="panel-kicker">РЕЗЕРВНАЯ КОПИЯ</div><h2>Экспорт данных</h2><p>Скачайте все модели, партии и записи продаж в формате JSON. Файл можно сохранить в облачное хранилище или перенести на другой компьютер.</p><div className="backup-preview"><FileDown size={19} /><span><strong>libre-ledger-{today()}.json</strong><small>Полный архив рабочего пространства</small></span><button className="icon-button" onClick={onExport} aria-label="Скачать резервную копию"><Download size={17} /></button></div><button className="button button-quiet" onClick={onExport}><Download size={16} />Скачать резервную копию</button></div><div className="panel settings-panel method-panel"><div className="panel-kicker">МЕТОД УЧЁТА</div><h2>Скользящая средняя</h2><p>При продаже себестоимость рассчитывается как средняя цена всех закупок данной модели в наличии. Это помогает корректно учитывать разные закупочные цены без ручного выбора партии.</p><div className="method-equation"><span>стоимость остатков</span><i>÷</i><span>количество на складе</span><i>=</i><strong>средняя себестоимость</strong></div></div><div className="settings-panel privacy-note"><ShieldCheck size={18} /><span><strong>Доступ только у вас</strong>Firebase-правила ограничивают чтение и запись владельцем аккаунта.</span><span className="settings-configured">{configured ? 'Firebase настроен' : 'Firebase ещё не настроен'}</span></div></div>
}

function ModalShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const container = box.current
    const focusable = () => Array.from(container?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') ?? [])
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

function EntryForm({ type, models, onSubmit, onClose }: { type: 'purchase' | 'sale'; models: Model[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const purchase = type === 'purchase'
  const [modelId, setModelId] = useState(models[0]?.id ?? '')
  const model = models.find((item) => item.id === modelId)
  return <form onSubmit={onSubmit}><div className="modal-topline"><span className={`modal-icon ${purchase ? 'modal-buy-icon' : 'modal-sale-icon'}`}>{purchase ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}</span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><div className="modal-kicker">{purchase ? 'НОВОЕ ПОСТУПЛЕНИЕ' : 'НОВАЯ ПРОДАЖА'}</div><h2 id="modal-title">{purchase ? 'Записать закупку' : 'Записать продажу'}</h2><p className="modal-desc">{purchase ? 'Добавьте поступившие сенсоры и расходы на доставку.' : 'Введите количество и цену. Себестоимость посчитается автоматически.'}</p><label className="form-label">Модель<select name="modelId" value={modelId} onChange={(event) => setModelId(event.target.value)} required>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="field-chevron"><ChevronDown size={15} /></span></label><label className="form-label">Дата<input name="date" type="date" defaultValue={today()} required /></label><div className="form-row"><label className="form-label">Количество, шт.<input name="quantity" type="number" min="1" step="1" placeholder="Например, 6" required /></label><label className="form-label">Цена за штуку<input name="unitPrice" type="number" min="1" step="1" placeholder="₽" required /></label></div>{purchase && <label className="form-label">Доставка и другие расходы<input name="extra" type="number" min="0" step="1" placeholder="0 ₽" defaultValue="0" /><span className="field-help">Включатся в среднюю себестоимость</span></label>}{!purchase && <div className="cost-preview"><span>В наличии на выбранную дату · {model?.name.replace('FreeStyle ', '')}</span><strong>Списание по средней закупочной стоимости</strong></div>}<div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit"><Check size={16} />{purchase ? 'Добавить закупку' : 'Записать продажу'}</button></div></form>
}

function ModelForm({ onSubmit, onClose }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return <form onSubmit={onSubmit}><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Boxes size={19} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><div className="modal-kicker">КАТАЛОГ</div><h2 id="modal-title">Новая модель</h2><p className="modal-desc">Для каждой модели ведётся отдельный склад и своя средняя себестоимость.</p><label className="form-label">Название модели<input name="name" placeholder="Например, FreeStyle Libre 3" required autoFocus /></label><label className="form-label">Цвет модели<select name="color" defaultValue="#789c8b"><option value="#789c8b">Шалфейный</option><option value="#b89569">Тёплый золотой</option><option value="#8290a6">Серо-синий</option><option value="#b27c72">Пыльный терракотовый</option><option value="#827a9a">Серо-лиловый</option></select><span className="field-chevron"><ChevronDown size={15} /></span></label><div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit"><Plus size={16} />Добавить модель</button></div></form>
}

function LoginForm({ configured, mode, setMode, onSubmit, onClose }: { configured: boolean; mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  if (!configured) return <div><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Cloud size={19} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><div className="modal-kicker">ОБЛАЧНОЕ СОХРАНЕНИЕ</div><h2 id="modal-title">Сначала подключите Firebase</h2><p className="modal-desc">Для синхронизации бесплатно создайте проект Firebase, включите Email/Password в Authentication и Firestore. Значения Web App добавьте в `.env.local` по образцу `.env.example`.</p><div className="setup-steps"><span>1. Создайте проект на firebase.google.com</span><span>2. Включите вход Email/Password и Firestore</span><span>3. Скопируйте конфигурацию Web App в `.env.local`</span><span>4. Для GitHub Actions добавьте эти же значения в Secrets</span></div><div className="modal-actions"><button className="button button-primary" onClick={onClose}>Понятно</button></div></div>
  return <form onSubmit={onSubmit}><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Cloud size={19} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><div className="modal-kicker">ЛИЧНОЕ ОБЛАЧНОЕ СОХРАНЕНИЕ</div><h2 id="modal-title">{mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'}</h2><p className="modal-desc">Для доступа используйте разрешённый аккаунт. При регистрации потребуется подтвердить email.</p><label className="form-label">Электронная почта<input name="email" type="email" placeholder="Введите email" autoComplete="email" required /></label><label className="form-label">Пароль<input name="password" type="password" placeholder="Не менее 6 символов" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required /></label><button className="mode-toggle" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Впервые здесь? Создать аккаунт' : 'Уже есть аккаунт? Войти'}</button><div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit"><LogIn size={16} />{mode === 'login' ? 'Войти и синхронизировать' : 'Создать аккаунт'}</button></div></form>
}
