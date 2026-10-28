export const firebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyATJAPilBvfC_1kQOAlGpajEJ0Vv_b6RfY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'freestyle-libr.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'freestyle-libr',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:409455387862:web:5137fc5007fe213b489577',
}

export const allowedEmail = 'andrewokop@gmail.com'

export const firebaseConfigured = Object.values(firebaseOptions).every(Boolean)
