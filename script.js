const firebaseConfig = {
  apiKey: "AIzaSyBF8i7TVx8_lU6zYTl5b7nHDrZ-wJ0-kqk",
  authDomain: "efoot-tournament.firebaseapp.com",
  projectId: "efoot-tournament",
  storageBucket: "efoot-tournament.firebasestorage.app",
  messagingSenderId: "319953733524",
  appId: "1:319953733524:web:a2d666679e0d7d27713181",
  measurementId: "G-0FMPV5DGZT"
};

// 1. Initialize the App
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

// --- 2. GLOBAL STATE ---
let players = [];
let matches = [];
let currentPlayer = JSON.parse(sessionStorage.getItem('ef_user')) || null;
let currentMatchId = null;

// --- 3. THE "WATCHER" ---
function init() {
    if (currentPlayer) {
        const badge = document.getElementById('userBadge');
        if(badge) badge.innerText = `Logged in: ${currentPlayer.name} (${currentPlayer.team})`;
    }

    // Admin Check: Only the first registered player sees the Start Button
    db.collection("players").orderBy("id", "asc").limit(1).get().then((snapshot) => {
        if (!snapshot.empty) {
            const firstPlayer = snapshot.docs[0].data();
            if (currentPlayer && currentPlayer.id === firstPlayer.id) {
                const btn = document.getElementById('adminStartBtn');
                if(btn) btn.style.display = 'block';
            }
        }
    });

    // Sync Players
    db.collection("players").onSnapshot((snapshot) => {
        players = snapshot.docs.map(doc => doc.data());
        renderPlayerList();
        updateDropdown(); // Disables taken clubs in HTML
    });

    // Sync Matches
    db.collection("matches").onSnapshot((snapshot) => {
        matches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderBracket();
    });

    // Check if tournament is active
    db.collection("settings").doc("tournament").onSnapshot((doc) => {
        if (doc.exists() && doc.data().started) {
            document.getElementById('registrationSection').style.display = 'none';
            document.getElementById('bracketSection').style.display = 'block';
            const adminBtn = document.getElementById('adminStartBtn');
            if(adminBtn) adminBtn.style.display = 'none';
        }
    });
}

// --- 4. PUBLIC REGISTRATION ---
document.getElementById('regForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const name = document.getElementById('username').value.trim();
    const team = document.getElementById('teamSelect').value;

    if (players.some(p => p.team === team)) return alert("This team is already taken!");

    const newPlayer = { id: Date.now().toString(), name, team };
    
    await db.collection("players").doc(newPlayer.id).set(newPlayer);
    
    currentPlayer = newPlayer;
    sessionStorage.setItem('ef_user', JSON.stringify(newPlayer));
    location.reload(); 
});

// --- 5. ADMIN START ---
window.startTournament = async function() {
    if (players.length < 2) return alert("Need at least 2 players!");
    
    let shuffled = [...players].sort(() => 0.5 - Math.random());
    const batch = db.batch();

    for(let i = 0; i < shuffled.length; i += 2) {
        let p1 = shuffled[i];
        let p2 = shuffled[i+1] || { name: 'BYE', team: '-', id: 'bye' };
        
        let matchRef = db.collection("matches").doc();
        let matchData = {
            round: 16, p1, p2,
            score1: null, score2: null, winner: null,
            status: (p2.id === 'bye') ? 'verified' : 'open',
            photoUrl: null, reportedBy: null
        };
        
        if (p2.id === 'bye') {
            matchData.score1 = 1; matchData.score2 = 0;
            matchData.winner = p1;
        }
        batch.set(matchRef, matchData);
    }
    
    batch.set(db.collection("settings").doc("tournament"), { started: true });
    await batch.commit();
};

// --- 6. SCORE & VERIFICATION ---
window.openScoreModal = function(id) {
    currentMatchId = id;
    const match = matches.find(m => m.id === id);
    if(!match || match.status === 'verified') return;

    const upSec = document.getElementById('uploadSection');
    const verSec = document.getElementById('verifySection');
    const displayScore = document.getElementById('reportedScoreDisplay');
    const displayPhoto = document.getElementById('uploadedPhoto');

    if (match.status === 'waiting_verification') {
        upSec.style.display = 'none';
        verSec.style.display = 'block';
        
        // Correctly link the display elements to match data
        if(displayScore) displayScore.innerText = `${match.score1} - ${match.score2}`;
        if(displayPhoto) displayPhoto.src = match.photoUrl;

        // Hide verify buttons if YOU are the one who reported it
        const isReporter = match.reportedBy === currentPlayer.id;
        document.getElementById('verifyButtons').style.display = isReporter ? 'none' : 'flex';
        document.getElementById('waitMessage').style.display = isReporter ? 'block' : 'none';
    } else {
        upSec.style.display = 'block';
        verSec.style.display = 'none';
    }

    document.getElementById('overlay').style.display = 'block';
    document.getElementById('scoreModal').style.display = 'block';
};

window.submitInitialScore = async function() {
    const s1 = document.getElementById('score1').value;
    const s2 = document.getElementById('score2').value;
    const file = document.getElementById('matchPhoto').files[0];

    if(!file || s1 === "" || s2 === "") return alert("Please enter score and upload screenshot!");

    // Upload photo to storage
    const storageRef = storage.ref(`matches/${currentMatchId}`);
    await storageRef.put(file);
    const url = await storageRef.getDownloadURL();

    // Update match status to waiting_verification
    await db.collection("matches").doc(currentMatchId).update({
        score1: parseInt(s1),
        score2: parseInt(s2),
        photoUrl: url,
        status: 'waiting_verification',
        reportedBy: currentPlayer.id
    });

    closeModal();
};

window.confirmScore = async function(isCorrect) {
    const match = matches.find(m => m.id === currentMatchId);
    if (match.reportedBy === currentPlayer.id) return alert("Wait for opponent to verify!");

    if(isCorrect) {
        const winner = (match.score1 > match.score2) ? match.p1 : match.p2;
        await db.collection("matches").doc(currentMatchId).update({
            status: 'verified',
            winner: winner
        });
        promoteWinner(match, winner);
    } else {
        await db.collection("matches").doc(currentMatchId).update({status: 'disputed'});
        alert("Match Disputed! An admin must resolve this.");
    }
    closeModal();
};

async function promoteWinner(m, winner) {
    let nextRound = m.round / 2;
    if (nextRound < 1) return;
    
    // Find if a match for the next round exists with an empty slot
    const nextMatch = matches.find(x => x.round === nextRound && x.p2 === null);
    if (nextMatch) {
        await db.collection("matches").doc(nextMatch.id).update({ p2: winner });
    } else {
        // Create new match for next round
        await db.collection("matches").add({
            round: nextRound, p1: winner, p2: null,
            score1: null, score2: null, winner: null, status: 'open'
        });
    }
}

// --- 7. RENDERING HELPERS ---
function updateDropdown() {
    const select = document.getElementById('teamSelect');
    if(!select) return;
    
    const takenTeams = players.map(p => p.team);
    
    // Loop through HTML options to disable taken ones
    Array.from(select.options).forEach(opt => {
        if (opt.value && takenTeams.includes(opt.value)) {
            opt.disabled = true;
            opt.textContent = opt.value + " (ALREADY TAKEN)";
        }
    });
}

function renderBracket() {
    ['16', '8', '4', '2', '1'].forEach(r => {
        const el = document.getElementById(`round-${r}`);
        if(el) while(el.children.length > 1) el.removeChild(el.lastChild);
    });

    matches.sort((a,b) => a.round - b.round).forEach(m => {
        const roundDiv = document.getElementById(`round-${m.round}`);
        if (!roundDiv) return;

        const isMyMatch = currentPlayer && (m.p1.id === currentPlayer.id || (m.p2 && m.p2.id === currentPlayer.id));
        const div = document.createElement('div');
        div.className = `match-card ${m.status}`;
        
        div.onclick = () => {
            if (!isMyMatch) return alert("You are not a player in this match!");
            openScoreModal(m.id);
        };

        div.innerHTML = `
            <div class="match-player ${m.winner?.id === m.p1.id ? 'winner' : ''}">
                <span>${m.p1.name}</span><span>${m.score1 ?? '-'}</span>
            </div>
            <div class="match-player ${m.winner?.id === m.p2?.id ? 'winner' : ''}">
                <span>${m.p2?.name || 'WAITING...'}</span><span>${m.score2 ?? '-'}</span>
            </div>
            <small>${m.status === 'waiting_verification' ? '⚠️ VERIFY NOW' : ''}</small>
        `;
        roundDiv.appendChild(div);
    });
}

function renderPlayerList() {
    const list = document.getElementById('playerList');
    if(list) {
        list.innerHTML = players.map(p => `<li class="player-item">${p.name} <b>(${p.team})</b></li>`).join('');
        document.getElementById('playerCount').innerText = players.length;
    }
}

window.closeModal = () => {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('scoreModal').style.display = 'none';
};

window.resetData = async () => {
    if(confirm("DANGER: This will delete ALL data (players and matches). Continue?")) {
        const mDocs = await db.collection("matches").get();
        const pDocs = await db.collection("players").get();
        mDocs.forEach(d => d.ref.delete());
        pDocs.forEach(d => d.ref.delete());
        await db.collection("settings").doc("tournament").delete();
        sessionStorage.clear();
        location.reload();
    }
};

init();
