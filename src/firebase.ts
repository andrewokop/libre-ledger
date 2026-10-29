import {
  allowedEmail,
  firebaseConfigured,
  firebaseOptions
} from './firebaseConfig'
import { id, type Workspace } from './types'
import {
  GenerationError,
  parseWorkspace,
  SCHEMA_VERSION,
  type Action
} from './domain'
import {
  mergeActions,
  newCloud,
  parseCloud,
  toCloud,
  type CloudState
} from './syncProtocol'

export { firebaseConfigured }
export type AuthUser = import('firebase/auth').User

export function isAllowedEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === allowedEmail
}

export function authErrorMessage(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : ''
  const messages: Record<string, string> = {
    'auth/operation-not-allowed':
      'В Firebase включи Authentication → Sign-in method → Email/Password. Это частая причина ошибки 400 при регистрации.',
    'auth/configuration-not-found':
      'В Firebase включи Authentication → Sign-in method → Email/Password. Это частая причина ошибки 400 при регистрации.',
    'auth/unauthorized-domain':
      'Добавь andrewokop.github.io в Authentication → Settings → Authorized domains.',
    'auth/invalid-api-key':
      'Firebase отклонил API key. Проверь настройки Web App в Firebase Console.',
    'auth/email-already-in-use':
      'Этот адрес уже зарегистрирован. Переключись на «Войти».',
    'auth/invalid-credential': 'Неверный email или пароль.',
    'auth/invalid-login-credentials': 'Неверный email или пароль.',
    'auth/weak-password': 'Пароль должен содержать не менее 6 символов.',
    'auth/too-many-requests':
      'Слишком много попыток. Подожди немного и попробуй снова.',
    'auth/network-request-failed':
      'Не удалось подключиться к Firebase. Проверь интернет и попробуй снова.',
    'permission-denied':
      'Firestore отклонил доступ. Проверь опубликованные правила firestore.rules.',
    'failed-precondition':
      'Проверь, что база Cloud Firestore создана в проекте Firebase.'
  }
  return (
    messages[code] ??
    (error instanceof Error
      ? error.message
      : 'Не удалось подключиться к Firebase.')
  )
}

async function getFirebaseApp() {
  const appSdk = await import('firebase/app')
  return appSdk.getApps().length
    ? appSdk.getApp()
    : appSdk.initializeApp(firebaseOptions)
}

export async function observeAuth(callback: (user: AuthUser | null) => void) {
  if (!firebaseConfigured) return () => undefined
  const [app, authSdk] = await Promise.all([
    getFirebaseApp(),
    import('firebase/auth')
  ])
  return authSdk.onAuthStateChanged(authSdk.getAuth(app), callback)
}

export async function authenticate(
  email: string,
  password: string,
  register: boolean
) {
  if (!isAllowedEmail(email))
    throw new Error('Этот аккаунт не разрешён для входа.')
  const [app, authSdk] = await Promise.all([
    getFirebaseApp(),
    import('firebase/auth')
  ])
  const auth = authSdk.getAuth(app)
  email = email.trim().toLowerCase()
  if (register) {
    const credential = await authSdk.createUserWithEmailAndPassword(
      auth,
      email,
      password
    )
    await authSdk.sendEmailVerification(credential.user)
    await authSdk.signOut(auth)
    return 'verification-sent' as const
  }
  const credential = await authSdk.signInWithEmailAndPassword(
    auth,
    email,
    password
  )
  if (!credential.user.emailVerified) {
    await authSdk.sendEmailVerification(credential.user)
    await authSdk.signOut(auth)
    throw new Error(
      'Сначала подтверди email по ссылке из письма. Мы отправили письмо повторно.'
    )
  }
  return 'signed-in' as const
}

export async function logout() {
  if (!firebaseConfigured) return
  const [app, authSdk] = await Promise.all([
    getFirebaseApp(),
    import('firebase/auth')
  ])
  await authSdk.signOut(authSdk.getAuth(app))
}

export async function subscribeWorkspace(
  uid: string,
  onData: (workspace: CloudState, cached: boolean) => void,
  onError: (error: Error) => void
) {
  const [app, sdk] = await Promise.all([
    getFirebaseApp(),
    import('firebase/firestore')
  ])
  const reference = sdk.doc(
    sdk.getFirestore(app),
    'users',
    uid,
    'workspace',
    'main'
  )
  let active = true
  let initializing = false
  const stop = sdk.onSnapshot(
    reference,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!active || snapshot.metadata.hasPendingWrites) return
      const data = snapshot.exists() ? snapshot.data() : null
      if (
        data &&
        data.schemaVersion !== undefined &&
        data.schemaVersion !== 2 &&
        data.schemaVersion !== SCHEMA_VERSION
      ) {
        onError(
          Object.assign(
            new Error(
              'Облако использует неизвестный формат. Данные не изменены.'
            ),
            { code: 'unsupported-schema' }
          )
        )
        return
      }
      if (!data || data.schemaVersion !== SCHEMA_VERSION) {
        if (snapshot.metadata.fromCache || initializing) return
        initializing = true
        void sdk
          .runTransaction(sdk.getFirestore(app), async (transaction) => {
            const current = await transaction.get(reference)
            if (!current.exists()) {
              transaction.set(reference, {
                ...toCloud(newCloud(id())),
                updatedAt: sdk.serverTimestamp()
              })
              return
            }
            const old = current.data()
            if (old.schemaVersion === SCHEMA_VERSION) return
            if (old.schemaVersion !== undefined && old.schemaVersion !== 2)
              throw Object.assign(
                new Error(
                  'Облако использует неизвестный формат. Данные не изменены.'
                ),
                { code: 'unsupported-schema' }
              )
            const allowed = [
              'models',
              'purchases',
              'sales',
              'schemaVersion',
              'generation',
              'revision',
              'appliedIds',
              'updatedAt'
            ]
            if (Object.keys(old).some((key) => !allowed.includes(key)))
              throw new Error(
                'Неизвестные поля старого формата. Данные не изменены.'
              )
            const workspace = parseWorkspace(old)
            const versioned = old.schemaVersion === 2
            if (
              versioned &&
              (typeof old.generation !== 'string' ||
                !old.generation ||
                old.generation.length > 100 ||
                !Number.isSafeInteger(old.revision) ||
                old.revision < 1 ||
                !Array.isArray(old.appliedIds) ||
                old.appliedIds.length > 500 ||
                old.appliedIds.some(
                  (value: unknown) =>
                    typeof value !== 'string' || value.length > 100
                ))
            )
              throw new Error(
                'Повреждены метаданные облака. Данные не изменены.'
              )
            // Archive the exact original before replacing it, once and immutably.
            const backup = sdk.doc(
              sdk.getFirestore(app),
              'users',
              uid,
              'workspace',
              'pre-v3'
            )
            const existing = await transaction.get(backup)
            if (existing.exists())
              throw new Error(
                'Резервная копия перед миграцией уже существует. Данные не изменены; обратитесь к ней для восстановления.'
              )
            transaction.set(backup, old)
            const next = {
              workspace,
              generation: versioned ? old.generation : id(),
              revision: versioned ? old.revision + 1 : 1,
              appliedIds: versioned ? old.appliedIds : []
            }
            // Preserve exact legacy arrays, including all original record fields.
            transaction.set(reference, {
              ...toCloud({
                ...next,
                workspace: {
                  ...workspace,
                  models: old.models,
                  purchases: old.purchases,
                  sales: old.sales
                }
              }),
              updatedAt: sdk.serverTimestamp()
            })
          })
          .catch((error: Error) => {
            if (active) onError(error)
          })
          .finally(() => {
            initializing = false
          })
        return
      }
      try {
        onData(parseCloud(data), snapshot.metadata.fromCache)
      } catch (error) {
        onError(error as Error)
      }
    },
    onError
  )
  return () => {
    active = false
    stop()
  }
}

/** Exact legacy document archived by the migration transaction, or null if none exists. */
export async function exportMigrationBackup(
  uid: string
): Promise<Record<string, unknown> | null> {
  const [app, sdk] = await Promise.all([
    getFirebaseApp(),
    import('firebase/firestore')
  ])
  const reference = sdk.doc(
    sdk.getFirestore(app),
    'users',
    uid,
    'workspace',
    'pre-v3'
  )
  const snapshot = await sdk.getDoc(reference)
  return snapshot.exists() ? snapshot.data() : null
}

export async function saveWorkspace(
  uid: string,
  generation: string,
  actions: Action[]
) {
  const [app, sdk] = await Promise.all([
    getFirebaseApp(),
    import('firebase/firestore')
  ])
  const db = sdk.getFirestore(app)
  const reference = sdk.doc(db, 'users', uid, 'workspace', 'main')
  return sdk.runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new GenerationError()
    if (
      snapshot.data().schemaVersion === 2 ||
      snapshot.data().schemaVersion === undefined
    )
      throw Object.assign(
        new Error('Дождитесь завершения обновления облака.'),
        { code: 'unavailable' }
      )
    const remote = parseCloud(snapshot.data())
    const merged = mergeActions(remote, generation, actions)
    if (merged !== remote)
      transaction.set(reference, {
        ...toCloud(merged),
        updatedAt: sdk.serverTimestamp()
      })
    return merged
  })
}

export async function replaceWorkspace(
  uid: string,
  generation: string,
  workspace: Workspace
) {
  const clean = parseWorkspace(workspace)
  const [app, sdk] = await Promise.all([
    getFirebaseApp(),
    import('firebase/firestore')
  ])
  const db = sdk.getFirestore(app)
  const reference = sdk.doc(db, 'users', uid, 'workspace', 'main')
  const nextGeneration = id()
  return sdk.runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new GenerationError()
    const remote = parseCloud(snapshot.data())
    if (remote.generation !== generation) throw new GenerationError()
    const next = {
      workspace: clean,
      generation: nextGeneration,
      revision: remote.revision + 1,
      appliedIds: []
    }
    transaction.set(reference, {
      ...toCloud(next),
      updatedAt: sdk.serverTimestamp()
    })
    return next
  })
}
