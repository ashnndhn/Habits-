import { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  limit,
} from "firebase/firestore";

/**
 * STUDY HABIT TRACKER — Low-maintenance, mostly-frontend app
 * Backend: Firebase (Firestore, optional Anonymous Auth)
 * Features:
 *  - Up to 15 habits per user
 *  - Frequencies: daily / every 2 days / custom N days
 *  - Complete habits to gain points & XP; auto-calculated levels
 *  - Overall streak (days with at least one completion)
 *  - Live leaderboard (top 5)
 *  - Super simple login: click your name → enter code (or create new)
 *
 * Replace firebaseConfig with your own project values.
 */

// --- Firebase Config (REPLACE with your Firebase project settings) ---
const firebaseConfig = {
  apiKey: "AIzaSyChwjP0YECw_PWIuahNgOIwSd7EBZJ7rNc",
  authDomain: "habits-6f21b.firebaseapp.com",
  projectId: "habits-6f21b",
  storageBucket: "habits-6f21b.firebasestorage.app",
  messagingSenderId: "230998172960",
  appId: "1:230998172960:web:28e557f43d155e53d5e345",
};

// --- App init ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Utilities ---
const todayYMD = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const daysBetween = (from, to) => {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
};
const sha256 = async (text) => {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// --- Types (for readability only) ---
// Habit: { id, title, freq: 'daily'|'every2days'|'custom', intervalDays: number, lastDoneDate?: 'YYYY-MM-DD', totalCompletions: number }
// UserDoc: { codeHash, points, xp, level, overallStreak, lastActiveDate, habits: Habit[] }

export default function App() {
  // auth-ish (name + code only)
  const [roster, setRoster] = useState([]); // list of usernames
  const [selectedName, setSelectedName] = useState("");
  const [code, setCode] = useState("");
  const [codeHash, setCodeHash] = useState("");
  const [userDoc, setUserDoc] = useState(null); // UserDoc with server state
  const [loading, setLoading] = useState(true);

  // UI state
  const [newHabit, setNewHabit] = useState({ title: "", freq: "daily", intervalDays: 1 });

  // --- Load roster (names to click) ---
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "meta", "roster"), (snap) => {
      if (snap.exists()) setRoster(snap.data().names || []);
      else setRoster([]);
    });
    return () => unsub();
  }, []);

  // --- Select name helper: fill input from click ---
  const handlePickName = (name) => setSelectedName(name);

  // --- Login or create user (name + code) ---
  const handleEnter = async () => {
    if (!selectedName || !code) return alert("Enter name and code");
    const ch = await sha256(code);
    setCodeHash(ch);
    const ref = doc(db, "users", selectedName);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      // validate code
      const data = snap.data();
      if (data.codeHash !== ch) return alert("Wrong code for this name");
      subscribeToUser(selectedName); // start live updates
      setLoading(false);
    } else {
      // create new user with defaults
      const payload = {
        codeHash: ch,
        points: 0,
        xp: 0,
        level: 1,
        overallStreak: 0,
        lastActiveDate: null,
        habits: [],
      };
      await setDoc(ref, payload);
      // ensure name on roster
      const rosterRef = doc(db, "meta", "roster");
      const curr = await getDoc(rosterRef);
      const names = curr.exists() ? curr.data().names || [] : [];
      if (!names.includes(selectedName)) await setDoc(rosterRef, { names: [...names, selectedName].slice(0, 50) });
      subscribeToUser(selectedName);
      setLoading(false);
    }
  };

  // --- Live subscribe to user doc & leaderboard ---
  const [leaders, setLeaders] = useState([]);
  const subscribeToUser = (name) => {
    const uref = doc(db, "users", name);
    return onSnapshot(uref, (s) => {
      if (s.exists()) {
        setUserDoc({ name, ...s.data() });
      }
    });
  };
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "leaderboard", "global"), (snap) => {
      if (snap.exists()) setLeaders(snap.data().players || []);
      else setLeaders([]);
    });
    return () => unsub();
  }, []);

  // --- Derived helpers ---
  const levelFromXP = (xp) => Math.floor((xp || 0) / 100) + 1; // every 100 xp = +1 level
  const isHabitDue = (h, date = todayYMD()) => {
    const interval = h.freq === "daily" ? 1 : h.freq === "every2days" ? 2 : Math.max(1, h.intervalDays || 1);
    if (!h.lastDoneDate) return true; // never done → due
    return daysBetween(h.lastDoneDate, date) >= interval;
  };

  const dueCount = useMemo(() => {
    if (!userDoc) return 0;
    return (userDoc.habits || []).filter((h) => isHabitDue(h)).length;
  }, [userDoc]);

  // --- Mutations ---
  const addHabit = async () => {
    if (!userDoc) return;
    const list = userDoc.habits || [];
    if (list.length >= 15) return alert("Max 15 habits");
    const title = (newHabit.title || "Untitled").trim();
    if (!title) return alert("Give the habit a title");
    const freq = newHabit.freq;
    const intervalDays = freq === "custom" ? Math.max(1, Number(newHabit.intervalDays) || 1) : (freq === "every2days" ? 2 : 1);

    const habit = {
      id: crypto.randomUUID(),
      title,
      freq,
      intervalDays,
      lastDoneDate: null,
      totalCompletions: 0,
    };
    const ref = doc(db, "users", userDoc.name);
    await updateDoc(ref, { habits: [...list, habit] });
    setNewHabit({ title: "", freq: "daily", intervalDays: 1 });
  };

  const deleteHabit = async (id) => {
    if (!userDoc) return;
    const list = (userDoc.habits || []).filter((h) => h.id !== id);
    await updateDoc(doc(db, "users", userDoc.name), { habits: list });
  };

  const completeHabit = async (id) => {
    if (!userDoc) return;
    const today = todayYMD();
    const list = (userDoc.habits || []).map((h) => (h.id === id ? { ...h, lastDoneDate: today, totalCompletions: (h.totalCompletions || 0) + 1 } : h));

    // points + xp
    const addPoints = 10;
    const newXP = (userDoc.xp || 0) + addPoints;
    const newLevel = levelFromXP(newXP);

    // overall streak update: increments if lastActiveDate is yesterday or today (no double in one day), else reset to 1
    let newStreak = userDoc.overallStreak || 0;
    const last = userDoc.lastActiveDate;
    if (last === today) {
      // already active today → no change
    } else if (!last) {
      newStreak = 1;
    } else {
      const gap = daysBetween(last, today);
      if (gap === 1) newStreak = newStreak + 1; else newStreak = 1;
    }

    const ref = doc(db, "users", userDoc.name);
    await updateDoc(ref, {
      habits: list,
      points: (userDoc.points || 0) + addPoints,
      xp: newXP,
      level: newLevel,
      overallStreak: newStreak,
      lastActiveDate: today,
    });

    // Update leaderboard top 5
    const lref = doc(db, "leaderboard", "global");
    const lsnap = await getDoc(lref);
    let players = lsnap.exists() ? lsnap.data().players || [] : [];
    const me = { name: userDoc.name, points: (userDoc.points || 0) + addPoints, streak: newStreak, level: newLevel };
    players = players.filter((p) => p.name !== me.name).concat(me).sort((a, b) => b.points - a.points).slice(0, 5);
    await setDoc(lref, { players });
  };

  // --- UI ---
  if (!userDoc) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold mb-4">Study Habit Tracker</h1>
          <p className="text-gray-600 mb-6">Click your name, enter your code, and you’re in. Or create a new name.</p>

          {roster.length > 0 && (
            <div className="mb-6">
              <h2 className="font-semibold mb-2">Class List</h2>
              <div className="flex flex-wrap gap-2">
                {roster.map((n) => (
                  <button key={n} onClick={() => handlePickName(n)} className={`px-3 py-1 rounded border ${selectedName === n ? 'bg-blue-600 text-white' : 'bg-white'}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <input className="border rounded p-2" placeholder="Your name" value={selectedName} onChange={(e) => setSelectedName(e.target.value)} />
            <input type="password" className="border rounded p-2" placeholder="Your code (PIN)" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button onClick={handleEnter} className="mt-4 px-4 py-2 rounded bg-blue-600 text-white">Enter</button>

          <div className="mt-10">
            <h2 className="text-xl font-semibold mb-2">Leaderboard</h2>
            <LeaderboardView />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Hi, {userDoc.name}</h1>
            <p className="text-gray-600">Level {userDoc.level || 1} • {userDoc.points || 0} pts • XP {(userDoc.xp || 0)} • 🔥 {userDoc.overallStreak || 0}</p>
          </div>
          <button className="px-3 py-2 rounded border" onClick={() => setUserDoc(null)}>Switch user</button>
        </header>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-1">Your Habits</h2>
          <p className="text-gray-600 mb-3">{dueCount} due today</p>

          <div className="grid gap-3">
            {(userDoc.habits || []).map((h) => {
              const due = isHabitDue(h);
              return (
                <div key={h.id} className="p-3 rounded-xl border bg-white flex items-center justify-between">
                  <div>
                    <div className="font-medium">{h.title}</div>
                    <div className="text-sm text-gray-600">
                      {h.freq === 'daily' && 'Daily'}
                      {h.freq === 'every2days' && 'Every 2 days'}
                      {h.freq === 'custom' && `Every ${Math.max(1, h.intervalDays || 1)} days`}
                      {h.lastDoneDate && ` • Last done ${h.lastDoneDate}`}
                      {!due && ` • Next due in ${Math.max(0, (h.freq === 'daily' ? 1 : h.freq === 'every2days' ? 2 : Math.max(1, h.intervalDays || 1)) - daysBetween(h.lastDoneDate || todayYMD(), todayYMD()))} day(s)`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => deleteHabit(h.id)} className="px-2 py-1 text-sm rounded border">Delete</button>
                    <button disabled={!due} onClick={() => completeHabit(h.id)} className={`px-3 py-2 rounded text-white ${due ? 'bg-green-600' : 'bg-gray-400 cursor-not-allowed'}`}>{due ? 'Complete (+10)' : 'Not due'}</button>
                  </div>
                </div>
              );
            })}
          </div>

          {(userDoc.habits || []).length < 15 && (
            <div className="mt-4 p-4 rounded-xl border bg-white">
              <h3 className="font-semibold mb-2">Add Habit</h3>
              <div className="grid sm:grid-cols-3 gap-2">
                <input className="border rounded p-2" placeholder="Title (e.g., Read 20 mins)" value={newHabit.title} onChange={(e) => setNewHabit({ ...newHabit, title: e.target.value })} />
                <select className="border rounded p-2" value={newHabit.freq} onChange={(e) => setNewHabit({ ...newHabit, freq: e.target.value })}>
                  <option value="daily">Daily</option>
                  <option value="every2days">Every 2 days</option>
                  <option value="custom">Custom (N days)</option>
                </select>
                {newHabit.freq === "custom" && (
                  <input type="number" min={1} className="border rounded p-2" placeholder="Interval days" value={newHabit.intervalDays} onChange={(e) => setNewHabit({ ...newHabit, intervalDays: e.target.value })} />
                )}
              </div>
              <button onClick={addHabit} className="mt-3 px-4 py-2 rounded bg-blue-600 text-white">Add Habit</button>
            </div>
          )}
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-2">Leaderboard (Top 5)</h2>
          <LeaderboardView leaders={leaders} />
        </section>

        <footer className="text-xs text-gray-500">Made with Firebase • Keep codes private for light security (classroom use)</footer>
      </div>
    </div>
  );
}

function LeaderboardView({ leaders }) {
  const [state, setState] = useState(leaders || []);
  useEffect(() => setState(leaders || []), [leaders]);

  if (!state || state.length === 0) return <div className="text-gray-500">No players yet.</div>;
  return (
    <ol className="bg-white rounded-xl border divide-y">
      {state.map((p, i) => (
        <li key={p.name} className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <span className="w-6 text-center font-mono">{i + 1}</span>
            <span className="font-medium">{p.name}</span>
          </div>
          <div className="text-sm text-gray-700">{p.points} pts • 🔥 {p.streak} • Lv {p.level || 1}</div>
        </li>
      ))}
    </ol>
  );
}

export default App
