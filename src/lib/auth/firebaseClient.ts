import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

let app: FirebaseApp | undefined
let auth: Auth | undefined

export function getFirebaseApp(): FirebaseApp {
  if (app) return app
  if (getApps().length > 0) {
    app = getApps()[0]
    return app
  }
  app = initializeApp(firebaseConfig)
  return app
}

export function getFirebaseAuth(): Auth {
  if (auth) return auth
  const firebaseApp = getFirebaseApp()
  auth = getAuth(firebaseApp)
  return auth
}

export async function setAuthPersistence(remember: boolean): Promise<void> {
  const firebaseAuth = getFirebaseAuth()
  await setPersistence(firebaseAuth, remember ? browserLocalPersistence : browserSessionPersistence)
}
