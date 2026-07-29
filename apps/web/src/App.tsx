import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import { Board } from './Board.js';
import { CaravanClient } from './net.js';

/**
 * Landing page, board, and the connection chrome around both.
 *
 * Everything that is *about* the session rather than the game — title, code,
 * seats, turn counter, errors, the leave button — is packed into one box that
 * rides at the top of the hand column, so the table has the window's full width
 * and height to itself.
 */
export function App() {
  const client = useMemo(() => new CaravanClient(), []);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [code, setCode] = useState('');

  useEffect(() => {
    client.connect();
    return () => client.dispose();
  }, [client]);

  const seated = state.seat !== null;
  // The final board is the record of how the match went, so it stays up once
  // the room ends rather than being swapped out for a bare message — the result
  // is laid over it. Ending the room only freezes the board; it does not remove
  // it. Note the room reports "ended" on any disconnect after a decided match,
  // not just on abandonment, so this is the common path and not an edge case.
  const showBoard = state.match !== null;
  const frozen = state.status === 'ended';

  // Handed to the Board so it can sit above the hand. With no board to host it —
  // the landing page — it stands on its own instead.
  const panel = (
    <section className="panel">
      <h1>Caravan</h1>

      {seated && (
        <>
          <span className="meta">
            <span className="meta-label">Table</span>
            <strong className="code">{state.code}</strong>
          </span>
          <Seats present={state.present} you={state.seat!} />
          <Status state={state} />
        </>
      )}

      <span className="spacer" />
      <span className={`conn conn-${state.connectivity}`}>{state.connectivity}</span>
      {seated && <button onClick={() => client.leave()}>Leave</button>}

      {state.error && <p className="error">{state.error}</p>}
    </section>
  );

  return (
    <main>
      {showBoard ? (
        <Board
          view={state.match!}
          onMove={(move) => client.play(move)}
          panel={panel}
          frozen={frozen}
        />
      ) : (
        panel
      )}

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

      {state.match?.result && <Result result={state.match.result} you={state.match.seat} />}
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
      <small className="dim">{why}</small>
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

/**
 * The one line that says where the session is up to. It carries its own label
 * because that label changes with the state it is reporting — "Turn" is wrong
 * for a match that has ended or has not started.
 */
function Status({ state }: { state: ReturnType<CaravanClient['getSnapshot']> }) {
  const countdown = useCountdown(state.reconnectDeadline);

  const [label, body] = ((): [string, ReactElement] => {
    if (state.status === 'ended') {
      return ['Ended', <span className="status warn">{state.endedReason}</span>];
    }
    if (state.status === 'waiting') {
      return ['Waiting', <span className="status">Share the code for an opponent</span>];
    }
    if (countdown !== null) {
      return ['Waiting', <span className="status warn">Reconnecting… {countdown}s</span>];
    }
    if (state.match) {
      return [
        'Turn',
        <span className="status">
          {state.match.phase === 'opening' ? 'opening round' : `turn ${state.match.ply + 1}`}
        </span>,
      ];
    }
    return ['Turn', <span className="status">seated</span>];
  })();

  return (
    <span className="meta">
      <span className="meta-label">{label}</span>
      {body}
    </span>
  );
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
