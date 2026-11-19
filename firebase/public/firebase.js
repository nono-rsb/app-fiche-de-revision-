import {
  initializeApp, getAuth, connectAuthEmulator,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
} from './vendor/firebase.js';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Cache local persistant : la liste des fiches et les fiches déjà ouvertes restent lisibles hors connexion.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager(), cacheSizeBytes: 150 * 1024 * 1024 }),
});

// En local (localhost), on parle aux émulateurs Firebase : jamais aux vraies données.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
