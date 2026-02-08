// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBF8i7TVx8_lU6zYTl5b7nHDrZ-wJ0-kqk",
    authDomain: "efoot-tournament.firebaseapp.com",
    databaseURL: "https://efoot-tournament-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "efoot-tournament",
    storageBucket: "efoot-tournament.firebasestorage.app",
    messagingSenderId: "319953733524",
    appId: "1:319953733524:web:a2d666679e0d7d27713181"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const rtdb = firebase.database();
const storage = firebase.storage();

// --- 2. GLOBAL STATE ---
let players = [];
let matches = [];
let currentPlayer = JSON.parse(sessionStorage.getItem('ef_user')) || null;
let currentMatchId = null;

// --- 3. INITIALIZATION ---
function init() {
    if (currentPlayer) {
        document.getElementById('userBadge').innerText = `Connected: ${currentPlayer.name}`;
    }

    rtdb.ref('players').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        players = Object.keys(data).map(key => data[key]).sort((a, b) => a.id - b.id);
        renderPlayerList();
        
        // Show Admin Start button only to the first user
        const adminBtn = document.getElementById('adminStartBtn');
        if (currentPlayer && players.length > 0 && currentPlayer.id === players[0].id) {
            if(adminBtn) adminBtn.style.display = 'inline-block';
        }
    });

    rtdb.ref('matches').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        matches = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        renderBracket();
    });

    rtdb.ref('settings/tournament').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.started) {
            document.getElementById('registrationSection').style.display = 'none';
            document.getElementById('bracketSection').style.display = 'block';
        }
    });
}

// --- 4. REGISTRATION ---
document.getElementById('regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('username').value.trim();
    const team = document.getElementById('teamSelect').value;
    if (players.some(p => p.team === team)) return alert("Team taken!");
    const id = Date.now().toString();
    const newUser = { id, name, team };
    await rtdb.ref('players/' + id).set(newUser);
    sessionStorage.setItem('ef_user', JSON.stringify(newUser));
    location.reload(); 
});

// --- 5. TOURNAMENT CONTROL ---
window.startTournament = async () => {
    if (players.length < 2) return alert("Need more players!");
    let shuffled = [...players].sort(() => 0.5 - Math.random());
    let updates = {};
    for(let i = 0; i < shuffled.length; i += 2) {
        let p1 = shuffled[i];
        let p2 = shuffled[i+1] || { name: 'BYE', id: 'bye', team: '-' };
        let mId = rtdb.ref().child('matches').push().key;
        updates['/matches/' + mId] = {
            round: 16, p1, p2, 
            status: (p2.id === 'bye' ? 'verified' : 'open'),
            score1: (p2.id === 'bye' ? 3 : 0),
            score2: 0,
            winner: (p2.id === 'bye' ? p1 : null)
        };
    }
    updates['/settings/tournament'] = { started: true };
    await rtdb.ref().update(updates);
};

// --- 6. MODAL & INSTANT SUBMIT ---
window.openScoreModal = (id) => {
    currentMatchId = id;
    const match = matches.find(m => m.id === id);
    const isAdmin = currentPlayer && players.length > 0 && currentPlayer.id === players[0].id;
    
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('scoreModal').style.display = 'block';

    // Reset views
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('verifySection').style.display = 'none';

    if (match.status === 'open') {
        // Show submit form to players
        document.getElementById('uploadSection').style.display = 'block';
    } else if (match.status === 'verified') {
        // Show result & photo to everyone (or Admin)
        document.getElementById('verifySection').style.display = 'block';
        document.getElementById('reportedScoreDisplay').innerText = `${match.score1} - ${match.score2}`;
        document.getElementById('uploadedPhoto').src = match.photoUrl;
        
        // Show Admin fix buttons only to Admin
        document.getElementById('verifyButtons').style.display = isAdmin ? 'flex' : 'none';
    }
};

window.submitInitialScore = async () => {
    const s1 = parseInt(document.getElementById('score1').value);
    const s2 = parseInt(document.getElementById('score2').value);
    const file = document.getElementById('matchPhoto').files[0];
    
    if(!file || isNaN(s1) || isNaN(s2)) return alert("Enter scores and upload photo!");

    // Upload Photo
    const ref = storage.ref().child(`proofs/${currentMatchId}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();

    const match = matches.find(m => m.id === currentMatchId);
    const winner = (s1 > s2) ? match.p1 : match.p2;

    // Save and FINISH immediately
    await rtdb.ref('matches/' + currentMatchId).update({
        score1: s1, score2: s2, photoUrl: url, 
        status: 'verified', winner: winner
    });

    promoteWinner(match, winner);
    closeModal();
};

// Admin function to fix a wrong score
window.confirmScore = async (isConfirm) => {
    if (isConfirm) {
        closeModal(); // Everything is fine
    } else {
        // "Dispute" clicked by Admin -> Reset match to open
        if(confirm("Admin: Reset this match to fix the score?")) {
            await rtdb.ref('matches/' + currentMatchId).update({
                status: 'open', score1: 0, score2: 0, winner: null
            });
            closeModal();
        }
    }
};

function promoteWinner(m, winner) {
    let nextR = m.round / 2;
    if (nextR < 1) return;
    const nextMatch = matches.find(x => x.round === nextR && !x.p2 && x.status === 'open');
    if (nextMatch) {
        rtdb.ref('matches/' + nextMatch.id).update({ p2: winner });
    } else {
        rtdb.ref('matches').push({
            round: nextR, p1: winner, p2: null,
            status: 'open', winner: null, score1: 0, score2: 0
        });
    }
}

// --- 7. UI RENDERING ---
function renderBracket() {
    ['16', '8', '4', '2', '1'].forEach(r => {
        const div = document.getElementById(`round-${r}`);
        if(!div) return;
        div.innerHTML = `<h3>ROUND OF ${r}</h3>`;
        matches.filter(m => m.round == r).forEach(m => {
            const card = document.createElement('div');
            card.className = `match-card ${m.status}`;
            
            const isAdmin = currentPlayer && players.length > 0 && currentPlayer.id === players[0].id;
            const isMine = currentPlayer && (m.p1.id === currentPlayer.id || (m.p2 && m.p2.id === currentPlayer.id));

            // Admin can open any match. Players open their own.
            if (isAdmin || isMine) {
                card.onclick = () => openScoreModal(m.id);
            }

            card.innerHTML = `
                <div class="${m.winner?.id === m.p1.id ? 'winner' : ''}">${m.p1.name} <b>${m.score1}</b></div>
                <div class="${m.winner?.id === m.p2?.id ? 'winner' : ''}">${m.p2?.name || '...'} <b>${m.score2}</b></div>
            `;
            div.appendChild(card);
        });
    });
}

function renderPlayerList() {
    document.getElementById('playerList').innerHTML = players.map(p => `<li>${p.name} (${p.team})</li>`).join('');
    document.getElementById('playerCount').innerText = players.length;
}

window.closeModal = () => {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('scoreModal').style.display = 'none';
};

window.resetData = async () => {
    if(confirm("Wipe tournament?")) {
        await rtdb.ref('/').remove();
        sessionStorage.clear();
        location.reload();
    }
};

init();
