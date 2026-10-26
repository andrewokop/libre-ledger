import { firebaseConfigured, firebaseOptions } from './firebaseConfig'
import type { Workspace } from './types'

export { firebaseConfigured }
export type AuthUser = import('firebase/auth').User

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
  const [app, authSdk] = await Promise.all([getFirebaseApp(), import('firebase/auth')])
  const auth = authSdk.getAuth(app)
  if (register) return authSdk.createUserWithEmailAndPassword(auth, email, password)
  return authSdk.signInWithEmailAndPassword(auth, email, password)
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
