import type { SoloMode } from "./game/rules";
import type { ContinuationPresentation, RecordPresentation } from "./home-ui";
import { HowToPlay } from "./how-to-play";
import { BoardMacro, TokenCluster, Wordmark } from "./ui/Brand";
import { Icon, type IconName } from "./ui/Icon";
import { PieceGlyph } from "./ui/BoardDiagram";
import "./home-screen.css";

export interface HomeScreenProps {
  playEuclidSubtitle: string;
  records: readonly [RecordPresentation, RecordPresentation];
  continuation: ContinuationPresentation | null;
  soloMode: SoloMode;
  onSoloModeChange: (mode: SoloMode) => void;
  onPlayEuclid: () => void;
  onContinue: () => void;
  onWatchDemo: () => void;
  onOptions: () => void;
  onRules: () => void;
}

function RecordCard({
  record,
  owner,
}: {
  record: RecordPresentation;
  owner: 1 | 2;
}) {
  return (
    <article className="home-record" aria-label={`${record.label} record`}>
      <h3>
        <PieceGlyph owner={owner} size={16} />
        {record.label}
      </h3>
      <dl>
        <div className="home-record__rating">
          <dt>{record.statLabel}</dt>
          <dd className="num">{record.stat}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd>{record.record}</dd>
        </div>
        <div>
          <dt>History</dt>
          <dd>{record.detail}</dd>
        </div>
      </dl>
    </article>
  );
}

function ArrowButton({
  className,
  label,
  onClick,
}: {
  className: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={className} onClick={onClick}>
      <span>{label}</span>
      <Icon name="arrow" size={18} />
    </button>
  );
}

const UTILITIES: readonly {
  label: string;
  icon: IconName;
  action: "onOptions" | "onRules";
}[] = [
  { label: "Options", icon: "sliders", action: "onOptions" },
  { label: "Rules", icon: "help", action: "onRules" },
];

/** The home dashboard. It only presents; the app owns every game action. */
export function HomeScreen(props: HomeScreenProps) {
  const {
    playEuclidSubtitle,
    records,
    continuation,
    soloMode,
    onSoloModeChange,
    onPlayEuclid,
    onContinue,
    onWatchDemo,
    onOptions,
  } = props;

  return (
    <main className="screen euclid-home" aria-labelledby="euclid-home-title">
      <BoardMacro className="home-hero__art" />
      <div className="home">
        <header className="home-hero">
          <Wordmark id="euclid-home-title" size="lg" />
          <p className="home-hero__tagline">
            A minute to learn. A lifetime to master.
          </p>
        </header>

        <section className="home-grid" aria-label="Choose a game">
          <div className="home-grid__play">
            {continuation ? (
              <article className="panel home-card home-continue">
                <div className="home-card__copy">
                  <p className="eyebrow">Saved game</p>
                  <h2>{continuation.title}</h2>
                  <p>{continuation.detail}</p>
                  <p className="home-card__score num">{continuation.score}</p>
                  <p className="home-card__rules">{continuation.rules}</p>
                </div>
                <ArrowButton
                  className="btn btn--primary euclid-home__continue-button"
                  label="Continue"
                  onClick={onContinue}
                />
              </article>
            ) : null}

            <article className="panel home-card home-solo">
              <TokenCluster owner={1} className="home-card__tokens" />
              <div className="home-solo__head">
                <div className="home-card__copy">
                  <p className="eyebrow">Solo · against Euclid</p>
                  <h2>Play Euclid</h2>
                </div>
                <div
                  className="seg home-solo__mode"
                  role="radiogroup"
                  aria-label="Solo game type"
                >
                  {(["practice", "ranked"] as const).map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={soloMode === choice}
                      onClick={() => onSoloModeChange(choice)}
                    >
                      {choice === "ranked" ? "Ranked" : "Practice"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="home-solo__detail">{playEuclidSubtitle}</p>
              <div className="home-solo__actions">
                <button
                  type="button"
                  className="btn btn--primary btn--lg euclid-home__primary-action"
                  onClick={onPlayEuclid}
                >
                  <span className="euclid-home__primary-title">
                    {continuation ? "New game" : "Play Euclid"}
                  </span>
                  <Icon name="arrow" />
                </button>
                {/* Ranked rules are fixed; only Practice has a difficulty. */}
                {soloMode !== "ranked" ? (
                  <button
                    type="button"
                    className="btn btn--ghost home-solo__settings"
                    onClick={onOptions}
                  >
                    <Icon name="sliders" size={18} />
                    <span>Change difficulty</span>
                  </button>
                ) : null}
              </div>
            </article>

            <article className="panel home-card home-demo">
              <TokenCluster owner={2} className="home-card__tokens" />
              <div className="home-card__copy">
                <p className="eyebrow">Two-minute tour</p>
                <h2>Watch a demo game</h2>
                <p>A full game, narrated in six short lessons.</p>
              </div>
              <ArrowButton
                className="btn btn--blue euclid-home__secondary-button euclid-home__secondary-button--strong"
                label="Watch the demo"
                onClick={onWatchDemo}
              />
            </article>
          </div>

          <aside
            className="panel home-records"
            aria-labelledby="home-records-title"
          >
            <div className="home-card__copy">
              <p className="eyebrow">Against Euclid</p>
              <h2 id="home-records-title">Your records</h2>
              <p>Kept on this device. Ranked games move your rating.</p>
            </div>
            <div className="home-records__list">
              {records.map((record, index) => (
                <RecordCard
                  key={record.label}
                  record={record}
                  owner={index === 0 ? 1 : 2}
                />
              ))}
            </div>
          </aside>
        </section>

        <section className="home-learn" aria-labelledby="home-learn-title">
          <div className="home-learn__head">
            <h2 id="home-learn-title">Learn in a minute</h2>
            <p className="muted">
              Three ideas carry the whole game. Mastering them takes a lifetime.
            </p>
          </div>
          <HowToPlay layout="strip" />
        </section>

        <nav className="home-nav" aria-label="More Euclid options">
          <ul>
            {UTILITIES.map((item) => (
              <li key={item.label}>
                <button
                  type="button"
                  className="home-nav__item"
                  onClick={props[item.action]}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </main>
  );
}
