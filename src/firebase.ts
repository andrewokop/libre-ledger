import { allowedEmail, firebaseConfigured, firebaseOptions } from './firebaseConfig'
import type { Workspace } from './types'

export { firebaseConfigured }
export type AuthUser = import('firebase/auth').User

export function isAllowedEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === allowedEmail
}

export function authErrorMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const messages: Record<string, string> = {
    'auth/operation-not-allowed': 'В Firebase включи Authentication → Sign-in method → Email/Password. Это частая причина ошибки 400 при регистрации.',
    'auth/configuration-not-found': 'В Firebase включи Authentication → Sign-in method → Email/Password. Это частая причина ошибки 400 при регистрации.',
    'auth/unauthorized-domain': 'Добавь andrewokop.github.io в Authentication → Settings → Authorized domains.',
    'auth/invalid-api-key': 'Firebase отклонил API key. Проверь настройки Web App в Firebase Console.',
    'auth/email-already-in-use': 'Этот адрес уже зарегистрирован. Переключись на «Войти».',
    'auth/invalid-credential': 'Неверный email или пароль.',
    'auth/invalid-login-credentials': 'Неверный email или пароль.',
    'auth/weak-password': 'Пароль должен содержать не менее 6 символов.',
    'auth/too-many-requests': 'Слишком много попыток. Подожди немного и попробуй снова.',
    'auth/network-request-failed': 'Не удалось подключиться к Firebase. Проверь интернет и попробуй снова.',
    'permission-denied': 'Firestore отклонил доступ. Проверь опубликованные правила firestore.rules.',
    'failed-precondition': 'Проверь, что база Cloud Firestore создана в проекте Firebase.',
  }
  return messages[code] ?? (error instanceof Error ? error.message : 'Не удалось подключиться к Firebase.')
}

async function getFirebaseApp() {
  const appSdk = await import('firebase/app')
  return appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseOptions)
}

export async function observeAuth(callback: (user: AuthUser | null) => void) {
  if (!firebaseConfigured) return () => undefined
  const [app, authSdk] = await Promise.all([getFirebaseApp(), import('firebase/auth')])
  return authSdk.onAuthStateChanged(authSdk.getAuth(app), callback)
}

export async function authenticate(email: string, password: string, register: boolean) {
  if (!isAllowedEmail(email)) throw new Error('Этот аккаунт не разрешён для входа.')
  const [app, authSdk] = await Promise.all([getFirebaseApp(), import('firebase/auth')])
  const auth = authSdk.getAuth(app)
  if (register) {
    const credential = await authSdk.createUserWithEmailAndPassword(auth, email, password)
    await authSdk.sendEmailVerification(credential.user)
    await authSdk.signOut(auth)
    return 'verification-sent' as const
  }
  const credential = await authSdk.signInWithEmailAndPassword(auth, email, password)
  if (!credential.user.emailVerified) {
    await authSdk.sendEmailVerification(credential.user)
    await authSdk.signOut(auth)
    throw new Error('Сначала подтверди email по ссылке из письма. Мы отправили письмо повторно.')
  }
  return 'signed-in' as const
}

export async function logout() {
  if (!firebaseConfigured) return
  const [app, authSdk] = await Promise.all([getFirebaseApp(), import('firebase/auth')])
  await authSdk.signOut(authSdk.getAuth(app))
}

export async function subscribeWorkspace(uid: string, onData: (workspace: Workspace | null) => void, onError: (error: Error) => void) {
  const [app, { getFirestore, doc, onSnapshot }] = await Promise.all([getFirebaseApp(), import('firebase/firestore')])
  return onSnapshot(doc(getFirestore(app), 'users', uid, 'workspace', 'main'), (snapshot) => {
    onData(snapshot.exists() ? snapshot.data() as Workspace : null)
  }, onError)
}

export async function saveWorkspace(uid: string, workspace: Workspace) {
  const [app, { getFirestore, doc, setDoc }] = await Promise.all([getFirebaseApp(), import('firebase/firestore')])
  await setDoc(doc(getFirestore(app), 'users', uid, 'workspace', 'main'), workspace)
}
