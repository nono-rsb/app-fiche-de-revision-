// Point d'entrée du paquet « vendor » : le SDK Firebase et le générateur de QR code, embarqués dans le site
// (plus de dépendance à un CDN, et le site peut se charger hors connexion).
// Reconstruire après un changement :  npm run build:vendor
export { initializeApp } from 'firebase/app';
export {
  getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, updateProfile, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser,
} from 'firebase/auth';
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator,
  collection, doc, query, where, getDocs, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, writeBatch, Bytes,
  arrayUnion, arrayRemove,
} from 'firebase/firestore';
export { default as qrcode } from 'qrcode-generator';
