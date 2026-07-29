import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Board } from './Board.js';
import { CaravanClient } from './net.js';

/** Landing page, board, and the connection chrome around both. */
export function App() {
  const client = useMemo(() => new CaravanClient(), []);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [code, setCode] = useState('');

  useEffect(() => {
    client.connect();
    return () => client.dispose();
  }, [client]);

  const seated = state.seat !== null;

  return (
    <main>
      <header>
        <h1>Caravan</h1>
        <span className={`conn conn-${state.connectivity}`}>{state.connectivity}</span>
      </header>

      {state.error && <p className="error">{state.error}</p>}

      {!seated && (
        <section className="landing">
          <button onClick={() => client.createRoom()}>Create room</button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              client.joinRoom(code);
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CODE"
              maxLength={4}
              aria-label="Room code"
            />
            <button type="submit">Join</button>
          </form>
        </section>
      )}

      {seated && (
        <section className="room">
          <p>
            Room <strong className="code">{state.code}</strong> — you are{' '}
            <strong>player {state.seat}</strong>
          </p>
          <Seats present={state.present} you={state.seat!} />
          <Status state={state} />
          <button onClick={() => client.leave()}>Leave</button>
        </section>
      )}

      {state.match && state.status !== 'ended' && (
        <Board view={state.match} onMove={(move) => client.play(move)} />
      )}

      {state.match?.result && <Result result={state.match.result} you={state.match.seat} />}

      {state.log.length > 0 && <MoveLog log={state.log} />}
    </main>
  );
}

function Result({
  result,
  you,
}: {
  result: NonNullable<ReturnType<CaravanClient['getSnapshot']>['match']>['result'];
  you: 0 | 1;
}) {
  if (!result) return null;
  const text =
    result.kind === 'draw'
      ? `Draw — ${result.reason}`
      : result.seat === you
        ? `You win — ${result.reason}`
        : `You lose — ${result.reason}`;
  return <section className="result">{text}</section>;
}

function MoveLog({ log }: { log: string[] }) {
  const list = useRef<HTMLOListElement>(null);
  // Scroll the log's own container rather than calling scrollIntoView on a row:
  // that both avoids yanking the page around and keeps this effect from
  // depending on a DOM API that may be missing. A throw here happens during
  // commit and takes the whole board down with it.
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log.length]);
  return (
    <section className="log">
      <h2>Move log</h2>
      <ol ref={list}>
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </section>
  );
}

function Seats({ present, you }: { present: [boolean, boolean]; you: 0 | 1 }) {
  return (
    <ul className="seats">
      {[0, 1].map((seat) => (
        <li key={seat} className={present[seat] ? 'here' : 'away'}>
          Player {seat}
          {seat === you ? ' (you)' : ''} — {present[seat] ? 'connected' : 'waiting'}
        </li>
      ))}
    </ul>
  );
}

function Status({ state }: { state: ReturnType<CaravanClient['getSnapshot']> }) {
  const countdown = useCountdown(state.reconnectDeadline);

  if (state.status === 'ended') {
    return <p className="status">Match ended: {state.endedReason}.</p>;
  }
  if (state.status === 'waiting') {
    return <p className="status">Share the code — waiting for an opponent.</p>;
  }
  if (countdown !== null) {
    return <p className="status">Opponent reconnecting… {countdown}s</p>;
  }
  if (state.match) {
    return (
      <p className="counts">
        {state.match.phase} phase · ply {state.match.ply}
      </p>
    );
  }
  return <p className="status">Seated.</p>;
}

/** Seconds remaining until a deadline, or null when there is none. */
function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
