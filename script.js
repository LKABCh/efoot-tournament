const firebaseConfig = {
  apiKey: "AIzaSyBF8i7TVx8_lU6zYTl5b7nHDrZ-wJ0-kqk",
  authDomain: "efoot-tournament.firebaseapp.com",
  projectId: "efoot-tournament",
  storageBucket: "efoot-tournament.firebasestorage.app",
  messagingSenderId: "319953733524",
  appId: "1:319953733524:web:a2d666679e0d7d27713181",
  measurementId: "G-0FMPV5DGZT"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

let players = [];
let matches = [];
let currentPlayer = JSON.parse(sessionStorage.getItem('ef_user')) || null;

// --- REGISTRATION ---
document.getElementById('regForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    console.log("Submit button clicked");

    const name = document.getElementById('username').value.trim();
    const team = document.getElementById('teamSelect').value;

    if (!name || !team) {
        alert("Enter name and team!");
        return;
    }

    // Check if team is already taken
    const taken = players.some(p => p.team === team);
    if (taken) {
        alert("This team is already chosen!");
        return;
    }

    try {
        const newPlayer = { id: Date.now().toString(), name, team };
        console.log("Saving to Firebase...", newPlayer);
        
        await db.collection("players").doc(newPlayer.id).set(newPlayer);
        
        sessionStorage.setItem('ef_user', JSON.stringify(newPlayer));
        console.log("Saved successfully!");
        location.reload(); 
    } catch (err) {
        console.error("FIREBASE ERROR:", err);
        alert("Firebase Error: Check if Firestore is enabled in your console.");
    }
});

// --- REFRESH DROPDOWN ---
function updateDropdown() {
    const select = document.getElementById('teamSelect');
    if(!select) return;
    
    const takenTeams = players.map(p => p.team);
    
    Array.from(select.options).forEach(opt => {
        if (opt.value && takenTeams.includes(opt.value)) {
            opt.disabled = true;
            opt.textContent = opt.value + " (TAKEN)";
        }
    });
}

// --- OPEN MODAL (Everyone can see proof) ---
window.openScoreModal = function(id) {
    const match = matches.find(m => m.id === id);
    if(!match) return;

    const isMyMatch = currentPlayer && (match.p1.id === currentPlayer.id || match.p2?.id === currentPlayer.id);

    // If result reported, show it to everyone
    if (match.status === 'waiting_verification' || match.status === 'verified') {
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('verifySection').style.display = 'block';
        document.getElementById('reportedScoreDisplay').innerText = `${match.score1} - ${match.score2}`;
        document.getElementById('uploadedPhoto').src = match.photoUrl;

        const isReporter = match.reportedBy === currentPlayer?.id;
        const canVerify = isMyMatch && !isReporter && match.status === 'waiting_verification';

        document.getElementById('verifyButtons').style.display = canVerify ? 'flex' : 'none';
        document.getElementById('waitMessage').style.display = (isReporter && match.status === 'waiting_verification') ? 'block' : 'none';
    } 
    else if (match.status === 'open' && isMyMatch) {
        document.getElementById('uploadSection').style.display = 'block';
        document.getElementById('verifySection').style.display = 'none';
    }

    document.getElementById('overlay').style.display = 'block';
    document.getElementById('scoreModal').style.display = 'block';
    window.currentMatchId = id;
};

// --- SUBMIT SCORE ---
window.submitInitialScore = async function() {
    const s1 = document.getElementById('score1').value;
    const s2 = document.getElementById('score2').value;
    const file = document.getElementById('matchPhoto').files[0];

    if(!file || s1 === "" || s2 === "") return alert("Enter score and photo!");

    const ref = storage.ref(`matches/${window.currentMatchId}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();

    await db.collection("matches").doc(window.currentMatchId).update({
        score1: parseInt(s1), score2: parseInt(s2),
        photoUrl: url, status: 'waiting_verification', reportedBy: currentPlayer.id
    });
    location.reload();
};

// --- CONFIRM ---
window.confirmScore = async function(isCorrect) {
    const match = matches.find(m => m.id === window.currentMatchId);
    if(isCorrect) {
        const winner = (match.score1 > match.score2) ? match.p1 : match.p2;
        await db.collection("matches").doc(window.currentMatchId).update({ status: 'verified', winner: winner });
        // Add promotion logic here if needed
    } else {
        await db.collection("matches").doc(window.currentMatchId).update({ status: 'disputed' });
    }
    location.reload();
};

// --- INITIALIZE ---
function init() {
    db.collection("players").onSnapshot(snap => {
        players = snap.docs.map(doc => doc.data());
        updateDropdown();
        const list = document.getElementById('playerList');
        if(list) list.innerHTML = players.map(p => `<li>${p.name} (${p.team})</li>`).join('');
        document.getElementById('playerCount').innerText = players.length;
    });

    db.collection("matches").onSnapshot(snap => {
        matches = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Your existing bracket rendering logic...
    });
}

window.resetData = async () => {
    if(!confirm("DELETE ALL DATA?")) return;
    const mDocs = await db.collection("matches").get();
    const pDocs = await db.collection("players").get();
    for (const doc of mDocs.docs) await doc.ref.delete();
    for (const doc of pDocs.docs) await doc.ref.delete();
    await db.collection("settings").doc("tournament").delete();
    sessionStorage.clear();
    location.reload();
};

init();

