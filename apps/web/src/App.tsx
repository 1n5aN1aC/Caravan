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
          <button onClick={() => client.createRoom()}>Create a table</button>
          <span className="or">or join one</span>
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
              autoFocus
              aria-label="Room code"
            />
            <button type="submit" disabled={code.trim().length !== 4}>
              Join
            </button>
          </form>
        </section>
      )}

      {seated && (
        <section className="room">
          <span>
            Table <strong className="code">{state.code}</strong>
          </span>
          <Seats present={state.present} you={state.seat!} />
          <Status state={state} />
          <span className="spacer" />
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
  const lost = result.kind === 'winner' && result.seat !== you;
  const why =
    result.kind === 'draw'
      ? 'the turn limit was reached'
      : result.reason === 'tracks'
        ? 'all three tracks are decided'
        : 'a player ran out of legal moves';
  const headline =
    result.kind === 'draw' ? 'Draw' : result.seat === you ? 'You win' : 'You lose';
  return (
    <section className={`result ${lost ? 'lose' : ''}`}>
      {headline}
      <small className="dim"> — {why}</small>
    </section>
  );
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
        <li
          key={seat}
          className={present[seat] ? 'here' : 'away'}
          title={present[seat] ? 'Connected' : 'Not connected'}
        >
          {seat === you ? 'you' : 'opponent'}
        </li>
      ))}
    </ul>
  );
}

function Status({ state }: { state: ReturnType<CaravanClient['getSnapshot']> }) {
  const countdown = useCountdown(state.reconnectDeadline);

  if (state.status === 'ended') {
    return <span className="status warn">Match ended: {state.endedReason}</span>;
  }
  if (state.status === 'waiting') {
    return <span className="status">Share the code — waiting for an opponent</span>;
  }
  if (countdown !== null) {
    return <span className="status warn">Opponent reconnecting… {countdown}s</span>;
  }
  if (state.match) {
    return (
      <span className="status">
        {state.match.phase === 'opening' ? 'opening round' : `turn ${state.match.ply + 1}`}
      </span>
    );
  }
  return <span className="status">Seated</span>;
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
