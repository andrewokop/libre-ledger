import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Activity, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, Boxes, Check, ChevronDown, Cloud, CloudOff, Download, FileDown, Filter, LayoutDashboard, LogIn, LogOut, Plus, Search, Settings2, ShieldCheck, Trash2, X } from 'lucide-react'
import { authenticate as authenticateUser, authErrorMessage, firebaseConfigured, isAllowedEmail, logout, observeAuth, saveWorkspace, subscribeWorkspace, type AuthUser } from './firebase'
import { id, initialWorkspace, modelAccent, money, shortDate, today, type Model, type Purchase, type Sale, type Workspace } from './types'

import { Overview } from './Overview'
import { Amount, BrandMark } from './ui'

type Page = 'overview' | 'inventory' | 'history' | 'settings'
type Modal = 'purchase' | 'sale' | 'model' | 'login' | null
type Movement = { id: string; type: 'purchase' | 'sale'; date: string; name: string; quantity: number; amount: number }
type LotStats = { purchase: Purchase; remaining: number; sold: number; revenue: number; cogs: number }

const STORE_KEY = 'libre-ledger-v1'

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
  { page: 'inventory', label: 'Склад', icon: Boxes },
  { page: 'history', label: 'Операции', icon: ArrowLeftRight },
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
    const timer = window.setTimeout(() => setNotice(''), 4500)
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
  const pageSubtitle = page === 'overview' ? 'Прибыль, продажи и текущие остатки' : page === 'inventory' ? 'От поступления до возврата вложений' : page === 'history' ? 'История ваших закупок и продаж' : 'Сохранение, синхронизация и ваш аккаунт'
  function navigate(target: Page) { setPage(target); window.scrollTo({ top: 0, behavior: 'auto' }) }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">К содержимому</a>
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); navigate('overview') }} aria-label="Libre Ledger — на главную"><span className="brand-mark"><BrandMark /></span><span>libre<small>ledger</small></span></a>
        <div className="workspace-label"><span className="workspace-avatar">L</span><span><strong>Мой магазин</strong><small>FreeStyle Libre</small></span></div>
        <nav className="nav-list" aria-label="Основная навигация">{navItems.map(({ page: target, label, icon: Icon }) => <button key={target} aria-current={page === target ? 'page' : undefined} className={`nav-link ${page === target ? 'nav-active' : ''}`} onClick={() => navigate(target)}><Icon size={22} strokeWidth={1.8} /><span>{label}</span>{target === 'inventory' && <span className="nav-count">{stats.quantity}</span>}</button>)}</nav>
        <button className="sidebar-create" disabled={!stats.quantity} onClick={() => setModal('sale')}><Plus size={21} />Записать продажу</button>
        <div className="sidebar-bottom"><div className="sync-card"><ShieldCheck size={20} /><span><strong>Учёт сохраняется</strong><small>{user ? (syncError ? 'На устройстве · нет связи' : syncReady ? 'В облаке и на устройстве' : 'Синхронизация…') : 'На этом устройстве'}</small></span></div><button className="profile-row" onClick={() => user ? navigate('settings') : setModal('login')}><span className="avatar">L</span><span><strong>{user ? 'Мой аккаунт' : 'Личный кабинет'}</strong><small>{user ? 'Настройки аккаунта' : 'Подключить облако'}</small></span><ChevronDown size={18} /></button></div>
      </aside>

      <main className="main-area" id="main-content">
        <header className="topbar"><a className="mobile-brand" href="#overview" onClick={(event) => { event.preventDefault(); navigate('overview') }} aria-label="Libre Ledger — на главную"><BrandMark /><span>libre<span>ledger</span></span></a><span className="topbar-workspace">Мой магазин <span>/</span> FreeStyle Libre</span><div className="topbar-right"><span className="today-label">{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span><button className={`connection ${user && syncReady && !syncError ? 'connection-live' : ''}`} onClick={() => user ? navigate('settings') : setModal('login')}>{user ? <Cloud size={18} /> : <ShieldCheck size={18} />}<span>{user ? (syncError ? 'Нет связи' : syncReady ? 'Синхронизировано' : 'Сохраняем…') : 'На устройстве'}</span></button></div></header>
        <div className="content-wrap">
          <div className="page-heading"><div><h1>{page === 'overview' ? 'Обзор магазина' : pageTitle}</h1><p>{pageSubtitle}</p></div><div className="heading-actions"><button className="button button-quiet" onClick={() => setModal('purchase')}><ArrowDownLeft size={20} />Закупка</button><button className="button button-primary" disabled={!stats.quantity} title={!stats.quantity ? 'Сначала добавьте закупку' : undefined} onClick={() => setModal('sale')}><Plus size={21} />Новая продажа</button></div></div>
          {demoMode && <div className="demo-banner"><span className="demo-badge">Демо</span><span className="demo-copy">Пример с данными. <span>Посмотрите, как устроен учёт.</span></span><button onClick={() => { setWorkspace((current) => ({ models: current.models, purchases: [], sales: [] })); setDemoMode(false); setNotice('Пример очищен. Можно вносить свои данные') }}>Начать свой учёт<ArrowRight size={18} /></button></div>}
          <div className="page-content" key={page}>
            {page === 'overview' && <Overview workspace={workspace} stats={stats} onPage={navigate} />}
            {page === 'inventory' && <Inventory workspace={workspace} stats={stats} search={search} setSearch={setSearch} filterModel={filterModel} setFilterModel={setFilterModel} onAddModel={() => setModal('model')} />}
            {page === 'history' && <History movements={stats.movements} onDelete={deleteMovement} />}
            {page === 'settings' && <Settings user={user} configured={firebaseConfigured} syncError={syncError} onLogin={() => setModal('login')} onExport={exportData} onLogout={() => void logout()} />}
          </div>
          <footer className="footer"><span><BrandMark />Libre Ledger</span><button onClick={exportData}><Download size={17} />Резервная копия</button></footer>
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Мобильная навигация">{navItems.map(({ page: target, label, icon: Icon }) => <button key={target} aria-current={page === target ? 'page' : undefined} className={page === target ? 'bottom-active' : ''} onClick={() => navigate(target)}><span><Icon size={23} strokeWidth={page === target ? 2.2 : 1.7} /></span><span>{label}</span></button>)}</nav>
      {modal && <ModalShell onClose={() => setModal(null)}>{modal === 'purchase' && <EntryForm type="purchase" models={workspace.models} workspace={workspace} onSubmit={addPurchase} onClose={() => setModal(null)} />}{modal === 'sale' && <EntryForm type="sale" models={workspace.models.filter((model) => stats.lots.some((lot) => lot.purchase.modelId === model.id && lot.remaining > 0))} workspace={workspace} onSubmit={addSale} onClose={() => setModal(null)} />}{modal === 'model' && <ModelForm onSubmit={addModel} onClose={() => setModal(null)} />}{modal === 'login' && <LoginForm configured={firebaseConfigured} mode={loginMode} setMode={setLoginMode} onSubmit={authenticate} onClose={() => setModal(null)} />}</ModalShell>}
      {notice && <div className="toast" role="status"><span className="toast-check"><Check size={18} /></span>{notice}<button onClick={() => setNotice('')} aria-label="Закрыть уведомление"><X size={18} /></button></div>}
    </div>
  )
}

function Inventory({ workspace, stats, search, setSearch, filterModel, setFilterModel, onAddModel }: { workspace: Workspace; stats: ReturnType<typeof derive>; search: string; setSearch: (value: string) => void; filterModel: string; setFilterModel: (value: string) => void; onAddModel: () => void }) {
  const [onlyInStock, setOnlyInStock] = useState(false)
  const filtered = stats.lots.filter((lot) => (!onlyInStock || lot.remaining > 0) && (filterModel === 'all' || lot.purchase.modelId === filterModel) && workspace.models.find((model) => model.id === lot.purchase.modelId)?.name.toLowerCase().includes(search.toLowerCase().trim()))
  return <div className="page-stack">
    <section className="inventory-summary"><div><span>В наличии</span><strong>{stats.quantity}<small> сенсоров</small></strong></div><div><span>Деньги в товаре</span><strong><Amount value={stats.stockValue} /></strong></div><div><span>Активных партий</span><strong>{stats.lots.filter((lot) => lot.remaining > 0).length}</strong></div></section>
    <section className="panel inventory-panel"><div className="panel-head"><h2>Партии товара</h2><button className="button button-quiet" onClick={onAddModel}><Plus size={20} />Новая модель</button></div>
      <div className="filter-row"><label className="search-field"><Search size={20} /><input aria-label="Найти модель" placeholder="Найти модель" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="Очистить поиск" onClick={() => setSearch('')}><X size={18} /></button>}</label><label className="filter-select"><Filter size={19} /><select aria-label="Фильтр по модели" value={filterModel} onChange={(event) => setFilterModel(event.target.value)}><option value="all">Все модели</option>{workspace.models.map((model) => <option key={model.id} value={model.id}>{model.name.replace('FreeStyle ', '')}</option>)}</select><ChevronDown size={17} /></label><button className={`filter-chip ${onlyInStock ? 'filter-chip-active' : ''}`} aria-pressed={onlyInStock} onClick={() => setOnlyInStock(!onlyInStock)}>В наличии</button></div>
      <div className="table-scroll"><table className="data-table inventory-table"><thead><tr><th scope="col">Модель и закупка</th><th scope="col">Остаток</th><th scope="col">Себестоимость / шт.</th><th scope="col">Выручка</th><th scope="col">Окупаемость</th></tr></thead><tbody>{filtered.map((lot) => {
        const model = workspace.models.find((item) => item.id === lot.purchase.modelId)
        const invested = lot.purchase.quantity * lot.purchase.unitPrice + lot.purchase.extra
        const returned = invested ? lot.revenue / invested * 100 : 0
        return <tr key={lot.purchase.id} style={{ '--model-color': modelAccent(model?.color ?? '#526df4') } as CSSProperties}><td><div className="lot-model-cell"><span className="model-marker" /><span><strong>{model?.name.replace('FreeStyle ', '') ?? 'Сенсор'}</strong><small>{shortDate(lot.purchase.date)} · закуплено {lot.purchase.quantity} шт.</small></span></div></td><td data-label="Остаток"><strong className="table-primary stock-number">{lot.remaining} шт.</strong><small className="table-secondary">продано {lot.sold}</small></td><td data-label="Себестоимость / шт."><strong className="table-primary"><Amount value={lot.purchase.unitPrice + lot.purchase.extra / lot.purchase.quantity} /></strong><small className="table-secondary">{money(invested)} ₽ за партию</small></td><td data-label="Выручка"><strong className="table-primary positive-text"><Amount value={lot.revenue} /></strong><small className="table-secondary">прибыль {money(lot.revenue - lot.cogs)} ₽</small></td><td data-label="Окупаемость"><div className="payback"><div className="payback-label"><strong>{Math.round(returned)}%</strong><span>{returned >= 100 ? 'окуплено' : 'вернулось'}</span></div><div className="progress-track"><span style={{ width: `${Math.min(returned, 100)}%` }} /></div></div></td></tr>
      })}</tbody></table>{!filtered.length && <div className="empty-state"><Boxes size={35} /><strong>{stats.lots.length ? 'Ничего не найдено' : 'Склад пока пуст'}</strong><span>{stats.lots.length ? 'Попробуйте изменить поиск или фильтры.' : 'Добавьте закупку кнопкой вверху страницы.'}</span>{stats.lots.length > 0 && <button className="button button-quiet" onClick={() => { setSearch(''); setFilterModel('all'); setOnlyInStock(false) }}>Сбросить фильтры</button>}</div>}</div>
      <div className="inventory-note"><Activity size={19} /><span>Себестоимость включает доставку. Продажи списываются по средней цене модели.</span></div>
    </section>
  </div>
}

function History({ movements, onDelete }: { movements: Movement[]; onDelete: (movement: Movement) => void }) {
  const [filter, setFilter] = useState<'all' | 'sale' | 'purchase'>('all')
  const filtered = movements.filter((movement) => filter === 'all' || movement.type === filter)
  return <section className="panel history-panel"><div className="panel-head"><h2>Журнал операций</h2><span className="history-count">Записей: {filtered.length}</span></div><div className="history-filters" aria-label="Тип операции">{([['all', 'Все'], ['sale', 'Продажи'], ['purchase', 'Закупки']] as const).map(([value, label]) => <button key={value} className={`filter-chip ${filter === value ? 'filter-chip-active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="table-scroll"><table className="data-table history-table"><thead><tr><th scope="col">Дата</th><th scope="col">Операция</th><th scope="col">Модель</th><th scope="col">Количество</th><th scope="col">Сумма</th><th scope="col" aria-label="Действия" /></tr></thead><tbody>{filtered.map((movement) => <tr key={movement.id}><td className="history-date">{shortDate(movement.date)}</td><td className="history-type"><span className={`type-badge ${movement.type}`}>{movement.type === 'sale' ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}{movement.type === 'sale' ? 'Продажа' : 'Закупка'}</span></td><td className="history-model">{movement.name.replace('FreeStyle ', '')}</td><td className="history-quantity">{movement.quantity} шт.</td><td className={movement.type === 'sale' ? 'history-positive' : 'history-negative'}><Amount value={movement.amount} signed /></td><td className="history-delete"><button className="row-delete" title="Удалить запись" aria-label={`Удалить ${movement.type === 'sale' ? 'продажу' : 'закупку'} ${movement.name}`} onClick={() => onDelete(movement)}><Trash2 size={19} /></button></td></tr>)}</tbody></table>{!filtered.length && <div className="empty-state"><ArrowLeftRight size={35} /><strong>Здесь пока нет записей</strong><span>Операции появятся после добавления закупки или продажи.</span></div>}</div></section>
}

function Settings({ user, configured, syncError, onLogin, onExport, onLogout }: { user: AuthUser | null; configured: boolean; syncError: string; onLogin: () => void; onExport: () => void; onLogout: () => void }) {
  return <div className="settings-grid"><div className="panel settings-panel"><h2>Синхронизация</h2><p>Покупки и продажи сохраняются автоматически в этом браузере. Войдите, чтобы синхронизировать рабочее пространство между своими устройствами.</p><div className={`settings-status ${user && !syncError ? 'settings-ok' : syncError ? 'settings-error' : ''}`}><span className="settings-status-icon">{syncError ? <CloudOff size={18} /> : user ? <Cloud size={18} /> : <ShieldCheck size={18} />}</span><span><strong>{syncError ? 'Требуется подключение' : user ? 'Облачное сохранение включено' : configured ? 'Облако пока не подключено' : 'Сохранение на устройстве активно'}</strong><small>{syncError || (user ? 'Аккаунт синхронизирован' : configured ? 'Войдите, чтобы включить синхронизацию' : 'Локальные данные останутся доступны без регистрации')}</small></span></div>{user ? <button className="button button-quiet" onClick={onLogout}><LogOut size={16} />Выйти из аккаунта</button> : <button className="button button-primary" onClick={onLogin}><LogIn size={16} />Подключить синхронизацию</button>}</div><div className="panel settings-panel backup-panel"><h2>Экспорт данных</h2><p>Скачайте все модели, партии и записи продаж в формате JSON. Файл можно сохранить в облачное хранилище или перенести на другой компьютер.</p><div className="backup-preview"><FileDown size={19} /><span><strong>libre-ledger-{today()}.json</strong><small>Полный архив рабочего пространства</small></span><button className="icon-button" onClick={onExport} aria-label="Скачать резервную копию"><Download size={17} /></button></div><button className="button button-quiet" onClick={onExport}><Download size={16} />Скачать резервную копию</button></div><div className="panel settings-panel method-panel"><h2>Скользящая средняя</h2><p>При продаже себестоимость рассчитывается как средняя цена всех закупок данной модели в наличии. Это помогает корректно учитывать разные закупочные цены без ручного выбора партии.</p><div className="method-equation"><span>стоимость остатков</span><i>÷</i><span>количество на складе</span><i>=</i><strong>средняя себестоимость</strong></div></div><div className="settings-panel privacy-note"><ShieldCheck size={18} /><span><strong>Доступ только у вас</strong>Облачные данные доступны владельцу аккаунта.</span><span className="settings-configured">{configured ? 'Личный доступ' : 'Локальный режим'}</span></div></div>
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

function EntryForm({ type, models, workspace, onSubmit, onClose }: { type: 'purchase' | 'sale'; models: Model[]; workspace: Workspace; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const purchase = type === 'purchase'
  const [modelId, setModelId] = useState(models[0]?.id ?? '')
  const [date, setDate] = useState(today)
  const [quantity, setQuantity] = useState('1')
  const [price, setPrice] = useState('')
  const [extra, setExtra] = useState('0')
  const available = availableOn(workspace, modelId, date)
  const total = Number(quantity) * Number(price) + (purchase ? Number(extra) : 0)
  return <form onSubmit={onSubmit}><div className="modal-topline"><span className={`modal-icon ${purchase ? 'modal-buy-icon' : 'modal-sale-icon'}`}>{purchase ? <ArrowDownLeft size={25} /> : <ArrowUpRight size={25} />}</span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={23} /></button></div><h2 id="modal-title">{purchase ? 'Новая закупка' : 'Новая продажа'}</h2><p className="modal-desc">{purchase ? 'Добавьте товар и расходы на его доставку.' : 'Остатки и прибыль пересчитаются автоматически.'}</p><label className="form-label">Модель<select name="modelId" value={modelId} onChange={(event) => setModelId(event.target.value)} required>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span className="field-chevron"><ChevronDown size={18} /></span></label><label className="form-label">Дата<input name="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><div className="form-row"><label className="form-label">Количество, шт.<span className="quantity-input"><button type="button" aria-label="Уменьшить количество" disabled={Number(quantity) <= 1} onClick={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}>−</button><input name="quantity" aria-label="Количество, шт." type="number" inputMode="numeric" min="1" max={purchase ? undefined : available} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /><button type="button" aria-label="Увеличить количество" disabled={!purchase && Number(quantity) >= available} onClick={() => setQuantity(String(Number(quantity) + 1))}>+</button></span></label><label className="form-label">Цена за штуку, ₽<input name="unitPrice" type="number" inputMode="numeric" min="1" step="1" placeholder="0" value={price} onChange={(event) => setPrice(event.target.value)} required /></label></div>{purchase ? <label className="form-label">Доставка и другие расходы, ₽<input name="extra" type="number" inputMode="numeric" min="0" step="1" value={extra} onChange={(event) => setExtra(event.target.value)} /><span className="field-help">Включим в себестоимость товара</span></label> : <p className="availability-note"><Boxes size={18} />На выбранную дату в наличии: <strong>{available} шт.</strong></p>}<div className="cost-preview" aria-live="polite"><span>{purchase ? 'Закупка с доставкой' : 'Сумма продажи'}</span><strong><Amount value={total} /></strong></div><div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit"><Check size={19} />{purchase ? 'Добавить закупку' : 'Записать продажу'}</button></div></form>
}

function ModelForm({ onSubmit, onClose }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  return <form onSubmit={onSubmit}><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Boxes size={19} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><h2 id="modal-title">Новая модель</h2><p className="modal-desc">Для каждой модели ведётся отдельный склад и своя средняя себестоимость.</p><label className="form-label">Название модели<input name="name" placeholder="Например, FreeStyle Libre 3" required autoFocus /></label><label className="form-label">Цвет модели<select name="color" defaultValue="#526df4"><option value="#526df4">Синий</option><option value="#f5a66b">Абрикосовый</option><option value="#a493eb">Фиолетовый</option><option value="#75b7ee">Голубой</option><option value="#bd83cf">Сиреневый</option></select><span className="field-chevron"><ChevronDown size={15} /></span></label><div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit"><Plus size={16} />Добавить модель</button></div></form>
}

function LoginForm({ configured, mode, setMode, onSubmit, onClose }: { configured: boolean; mode: 'login' | 'register'; setMode: (mode: 'login' | 'register') => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  if (!configured) return <div><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Cloud size={19} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><h2 id="modal-title">Сначала подключите Firebase</h2><p className="modal-desc">Для синхронизации бесплатно создайте проект Firebase, включите Email/Password в Authentication и Firestore. Значения Web App добавьте в `.env.local` по образцу `.env.example`.</p><div className="setup-steps"><span>1. Создайте проект на firebase.google.com</span><span>2. Включите вход Email/Password и Firestore</span><span>3. Скопируйте конфигурацию Web App в `.env.local`</span><span>4. Для GitHub Actions добавьте эти же значения в Secrets</span></div><div className="modal-actions"><button className="button button-primary" onClick={onClose}>Понятно</button></div></div>
  return <form onSubmit={onSubmit}><div className="modal-topline"><span className="modal-icon modal-sale-icon"><Cloud size={19} /></span><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><h2 id="modal-title">{mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'}</h2><p className="modal-desc">Для доступа используйте разрешённый аккаунт. При регистрации потребуется подтвердить email.</p><label className="form-label">Электронная почта<input name="email" type="email" placeholder="Введите email" autoComplete="email" required /></label><label className="form-label">Пароль<input name="password" type="password" placeholder="Не менее 6 символов" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required /></label><button className="mode-toggle" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Впервые здесь? Создать аккаунт' : 'Уже есть аккаунт? Войти'}</button><div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Отмена</button><button className="button button-primary" type="submit"><LogIn size={16} />{mode === 'login' ? 'Войти и синхронизировать' : 'Создать аккаунт'}</button></div></form>
}
