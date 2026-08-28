// Firebase init + re-exports so the rest of the app has a single import point.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getDatabase, ref, get, set, update, remove, onValue,
  runTransaction, onDisconnect, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export {
  ref, get, set, update, remove, onValue,
  runTransaction, onDisconnect, serverTimestamp,
};

let signInPromise = null;

/** Resolves with the (anonymous) Firebase user, signing in if needed. */
export function signIn() {
  if (!signInPromise) {
    signInPromise = new Promise((resolve, reject) => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsub();
          resolve(user);
        } else {
          signInAnonymously(auth).catch((e) => {
            unsub();
            reject(e);
          });
        }
      }, reject);
    });
  }
  return signInPromise;
}
