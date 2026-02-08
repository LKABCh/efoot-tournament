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

// Initialize Firebase
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const rtdb = firebase.database();
const storage = firebase.storage();

// --- 2. GLOBAL STATE ---
let players = [];
let matches = [];
let currentPlayer = JSON.parse(sessionStorage.getItem('ef_user')) || null;
let currentMatchId = null;

// --- 3. CORE INITIALIZATION ---
function init() {
    console.log("⚽ eFootball Tournament System Active");

    if (currentPlayer) {
        const badge = document.getElementById('userBadge');
        if(badge) badge.innerText = `Connected: ${currentPlayer.name}`;
    }

    // Listener: Sync Players & Admin Rights
    rtdb.ref('players').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        // Sort by ID (timestamp) to ensure the first person is always the Admin
        players = Object.keys(data).map(key => data[key]).sort((a, b) => a.id - b.id);
        
        renderPlayerList();
        updateTeamDropdown(); 
        
        // Admin Logic
        const adminBtn = document.getElementById('adminStartBtn');
        if (currentPlayer && players.length > 0 && currentPlayer.id === players[0].id) {
            if(adminBtn) adminBtn.style.display = 'inline-block';
        }
    });

    // Listener: Sync Matches & Bracket UI
    rtdb.ref('matches').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        matches = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        renderBracket();
        if(currentMatchId) updateModalStatus(currentMatchId);
    });

    // Listener: Tournament Settings
    rtdb.ref('settings/tournament').on('value', (snapshot) => {
        const data = snapshot.val();
        if (data && data.started) {
            document.getElementById('registrationSection').style.display = 'none';
            document.getElementById('bracketSection').style.display = 'block';
        }
    });
}

// --- 4. REGISTRATION & TEAM LOCKING ---
document.getElementById('regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('username').value.trim();
    const team = document.getElementById('teamSelect').value;
    
    if(!name || !team) return alert("Fill in your name and pick a team!");

    // Security: Final check if team was taken
    const isTaken = players.some(p => p.team === team);
    if (isTaken) return alert("❌ This team was just taken! Choose another.");

    const id = Date.now().toString();
    const newUser = { id, name, team };
    
    try {
        await rtdb.ref('players/' + id).set(newUser);
        sessionStorage.setItem('ef_user', JSON.stringify(newUser));
        currentPlayer = newUser;
        location.reload(); 
    } catch (err) {
        alert("Error saving data. Check Firebase rules!");
    }
});

function updateTeamDropdown() {
    const takenTeams = players.map(p => p.team);
    const select = document.getElementById('teamSelect');
    if(!select) return;

    Array.from(select.options).forEach(opt => {
        if (opt.value === "") return;
        if (takenTeams.includes(opt.value)) {
            opt.disabled = true;
            opt.text = `${opt.value} (TAKEN)`;
        } else {
            opt.disabled = false;
            opt.text = opt.value;
        }
    });
}

// --- 5. TOURNAMENT CONTROL ---
window.startTournament = async () => {
    if (players.length < 2) return alert("Need at least 2 players!");

    let shuffled = [...players].sort(() => 0.5 - Math.random());
    let updates = {};

    // Use a temporary array to handle BYE promotion within the same transaction
    let round16Matches = [];

    for(let i = 0; i < shuffled.length; i += 2) {
        let p1 = shuffled[i];
        let p2 = shuffled[i+1] || { name: 'BYE', id: 'bye', team: '-' };
        let mId = rtdb.ref().child('matches').push().key;
        
        let matchObj = {
            round: 16, p1, p2, 
            status: (p2.id === 'bye' ? 'verified' : 'open'),
            score1: (p2.id === 'bye' ? 3 : null),
            score2: (p2.id === 'bye' ? 0 : null),
            winner: (p2.id === 'bye' ? p1 : null)
        };
        
        updates['/matches/' + mId] = matchObj;
        
        // If it's a BYE, we prepare promotion logic immediately
        if(p2.id === 'bye') {
            promoteWinnerSync(matchObj, p1, updates);
        }
    }
    
    updates['/settings/tournament'] = { started: true };
    await rtdb.ref().update(updates);
};

// Internal function to handle BYEs during the start tournament phase
function promoteWinnerSync(match, winner, updatesObj) {
    let nextR = match.round / 2;
    if (nextR < 1) return;

    // We look at the updates object to find an existing match in the next round
    let nextMatchId = Object.keys(updatesObj).find(key => 
        updatesObj[key].round === nextR && !updatesObj[key].p2 && updatesObj[key].status === 'open'
    );

    if (nextMatchId) {
        updatesObj[nextMatchId].p2 = winner;
    } else {
        let newKey = rtdb.ref().child('matches').push().key;
        updatesObj['/matches/' + newKey] = {
            round: nextR, p1: winner, p2: null,
            status: 'open', winner: null, score1: null, score2: null
        };
    }
}

// --- 6. SCORE REPORTING ---
window.openScoreModal = (id) => {
    currentMatchId = id;
    updateModalStatus(id);
    document.getElementById('overlay').style.display = 'block';
    document.getElementById('scoreModal').style.display = 'block';
};

function updateModalStatus(id) {
    const m = matches.find(x => x.id === id);
    if(!m) return;

    const upSec = document.getElementById('uploadSection');
    const verSec = document.getElementById('verifySection');
    const btnBox = document.getElementById('verifyButtons');
    const waitMsg = document.getElementById('waitMessage');

    if (m.status === 'waiting_verification') {
        upSec.style.display = 'none';
        verSec.style.display = 'block';
        document.getElementById('reportedScoreDisplay').innerText = `${m.score1} - ${m.score2}`;
        document.getElementById('uploadedPhoto').src = m.photoUrl;

        if (currentPlayer.id === m.reportedBy) {
            if(btnBox) btnBox.style.display = 'none';
            if(waitMsg) waitMsg.style.display = 'block';
        } else {
            if(btnBox) btnBox.style.display = 'flex';
            if(waitMsg) waitMsg.style.display = 'none';
        }
    } else {
        upSec.style.display = 'block';
        verSec.style.display = 'none';
    }
}

window.submitInitialScore = async () => {
    const s1 = document.getElementById('score1').value;
    const s2 = document.getElementById('score2').value;
    const file = document.getElementById('matchPhoto').files[0];
    
    if(!file || s1 === "" || s2 === "") return alert("Please fill all fields!");

    const ref = storage.ref().child(`proofs/${currentMatchId}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();

    await rtdb.ref('matches/' + currentMatchId).update({
        score1: parseInt(s1), 
        score2: parseInt(s2),
        photoUrl: url, 
        status: 'waiting_verification', 
        reportedBy: currentPlayer.id
    });
};

window.confirmScore = async (ok) => {
    if(!ok) return alert("Dispute reported to Admin.");

    const m = matches.find(x => x.id === currentMatchId);
    const winner = (m.score1 > m.score2) ? m.p1 : m.p2;

    await rtdb.ref('matches/' + currentMatchId).update({ status: 'verified', winner });
    
    promoteWinner(m, winner);
    closeModal();
};

async function promoteWinner(m, winner) {
    let nextR = m.round / 2;
    if (nextR < 1) return;

    // Refresh matches from DB to find the latest available slot
    const snap = await rtdb.ref('matches').once('value');
    const allMatches = snap.val() || {};
    
    const nextMatchKey = Object.keys(allMatches).find(key => 
        allMatches[key].round === nextR && !allMatches[key].p2 && allMatches[key].status === 'open'
    );

    if (nextMatchKey) {
        await rtdb.ref('matches/' + nextMatchKey).update({ p2: winner });
    } else {
        await rtdb.ref('matches').push({
            round: nextR, p1: winner, p2: null,
            status: 'open', winner: null, score1: null, score2: null
        });
    }
}

// --- 7. UI RENDERING ---
function renderBracket() {
    ['16', '8', '4', '2', '1'].forEach(r => {
        const div = document.getElementById(`round-${r}`);
        if(!div) return;
        const h3 = div.querySelector('h3');
        div.innerHTML = ''; if(h3) div.appendChild(h3);
        
        matches.filter(m => m.round == parseInt(r)).forEach(m => {
            const card = document.createElement('div');
            card.className = `match-card ${m.status}`;
            
            const isMine = currentPlayer && (m.p1.id === currentPlayer.id || m.p2?.id === currentPlayer.id);
            if(isMine && m.status !== 'verified') card.onclick = () => openScoreModal(m.id);

            card.innerHTML = `
                <div class="match-player ${m.winner?.id === m.p1.id ? 'winner' : ''}">
                    <span>${m.p1.name}</span> <b>${m.score1 !== null ? m.score1 : '-'}</b>
                </div>
                <div class="match-player ${m.winner?.id === m.p2?.id ? 'winner' : ''}">
                    <span>${m.p2?.name || '...'}</span> <b>${m.score2 !== null ? m.score2 : '-'}</b>
                </div>
            `;
            div.appendChild(card);
        });
    });
}

function renderPlayerList() {
    const list = document.getElementById('playerList');
    if(list) {
        list.innerHTML = players.map(p => `<li>${p.name} <span style="color:var(--primary)">(${p.team})</span></li>`).join('');
    }
    const count = document.getElementById('playerCount');
    if(count) count.innerText = players.length;
}

// --- 8. RESET DATA ---
window.resetData = async () => {
    if (confirm("🚨 WARNING: This will delete the tournament and ALL players. Proceed?")) {
        try {
            // 1. Wipe the Firebase Realtime Database
            await rtdb.ref('/').remove();

            // 2. Clear the browser's memory (the "Remember Me" part)
            sessionStorage.clear();
            localStorage.clear();

            alert("System Wiped! Returning to registration...");

            // 3. Force the page to reload from scratch
            window.location.href = window.location.origin + window.location.pathname;

        } catch (error) {
            console.error("Reset failed:", error);
            alert("Error: Make sure your Firebase Rules allow deletion (set .write to true).");
        }
    }
};

rtdb.ref('settings/tournament').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data && data.started) {
        document.getElementById('registrationSection').style.display = 'none';
        document.getElementById('bracketSection').style.display = 'block';
    } else {
        // If tournament hasn't started (or was reset), show registration!
        document.getElementById('registrationSection').style.display = 'block';
        document.getElementById('bracketSection').style.display = 'none';
    }
});

window.closeModal = () => {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('scoreModal').style.display = 'none';
    currentMatchId = null;
};

init();