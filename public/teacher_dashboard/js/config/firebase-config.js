// js/config/firebase-config.js

// Import the functions you need from the SDKs you need
// Use the v9 modular SDK imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.15.0/firebase-firestore.js";

// Your Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBw3b7RrcIzL7Otog58Bu52eUH5e3zab8I",
    authDomain: "iris-ai-prod.firebaseapp.com",
    projectId: "iris-ai-prod",
    storageBucket: "iris-ai-prod.firebasestorage.app",
    messagingSenderId: "223585438",
    appId: "1:223585438:web:7ceeb88553e550e1a0c78f",
    measurementId: "G-JF7KVLNXRL"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const auth = getAuth(app);
const db = getFirestore(app);

// Export the initialized services for use in other modules
export { auth, db };