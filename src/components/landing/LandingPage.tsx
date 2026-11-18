import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ChevronDown, Expand } from 'lucide-react';
import { useAuth } from '@/components/auth/authContextState';
import { BrandLockup } from '@/components/common/Brand';
import { examples, exampleUrl, type ExampleId } from '@/examples/catalog';
import { samplePaper, topicFromHash, topics, type TourTopic } from './tour';
import './tour.css';

function subscribeLocation(change: () => void) {
  window.addEventListener('hashchange', change);
  return () => window.removeEventListener('hashchange', change);
}

const currentHash = () => window.location.hash;

function ProductExample({ id }: { id: ExampleId }) {
  const example = examples[id];
  return (
    <figure className={id === 'overview' ? 'tour-figure tour-hero-figure' : 'tour-figure'}>
      <div className="tour-mat">
        <iframe
          data-colwrite-example=""
          key={id}
          className="tour-example"
          src={exampleUrl(id)}
          title={example.title}
          height={example.height}
        />
      </div>
      <figcaption>
        <span>{example.action}</span>
        <a className="tour-enlarge" href={exampleUrl(id)} target="_blank" rel="noreferrer">
          <Expand size={14} aria-hidden="true" /> Open example
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </figcaption>
    </figure>
  );
}

function Overview() {
  return (
    <>
      <div className="tour-hero">
        <div className="tour-hero-copy">
          <p className="tour-release">
            <span aria-hidden="true" />
            Invite-only alpha
          </p>
          <h1 id="tour-title">
            Write with your <em>sources in view.</em>
          </h1>
          <p className="tour-intro">
            Draft a research paper, check the evidence behind a claim, and review AI edits alongside the
            manuscript.
          </p>
          <div className="tour-actions">
            <a href="#editor" className="tour-primary">
              Explore the editor <ArrowRight size={17} aria-hidden="true" />
            </a>
            <a href={samplePaper} className="tour-text-link">
              Read the sample paper <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
        <ProductExample id="overview" />
      </div>
      <nav className="tour-directory" aria-labelledby="directory-heading">
        <h2 id="directory-heading">Explore the workspace</h2>
        <ul>
          {topics.map(({ id, label, icon: Icon, teaser }) => (
            <li key={id}>
              <a href={`#${id}`}>
                <Icon className="tour-topic-icon" size={20} strokeWidth={1.6} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{teaser}</small>
                </span>
                <ArrowUpRight className="tour-row-arrow" size={16} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

function TopicNavigation({ topic }: { topic: TourTopic }) {
  return (
    <nav className="tour-rail" aria-label="Tour views">
      <a href="#top" className="tour-back">
        <ArrowLeft size={15} aria-hidden="true" /> Overview
      </a>
      <ul>
        {topics.map(({ id, label, icon: Icon }) => (
          <li key={id}>
            <a href={`#${id}`} aria-current={topic.id === id ? 'page' : undefined}>
              <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
              {label}
            </a>
          </li>
        ))}
      </ul>
      <label className="tour-view-picker">
        <span className="sr-only">Choose a tour view</span>
        <select
          value={topic.id}
          onChange={(event) => {
            window.location.hash = event.target.value;
          }}
        >
          {topics.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </label>
    </nav>
  );
}

function TopicView({ topic }: { topic: TourTopic }) {
  const next = topics[topics.indexOf(topic) + 1];
  return (
    <div className="tour-chapter">
      <TopicNavigation topic={topic} />
      <div className="tour-article">
        <p className="tour-topic-name">
          <topic.icon size={15} aria-hidden="true" />
          {topic.label}
        </p>
        <h1 id="tour-title">{topic.title}</h1>
        <p className="tour-intro">{topic.intro}</p>
        <div className="tour-workflow">
          <ProductExample id={topic.id} />
          <div>
            <dl className="tour-details">
              {topic.details.map(({ label, text }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
            <a className="tour-guide" href={`/wiki/${topic.id}.html`}>
              <BookOpen size={16} aria-hidden="true" /> Read the wiki guide{' '}
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="tour-next">
          <a href={next ? `#${next.id}` : '#top'}>
            {next ? `Next · ${next.label}` : 'Back to overview'} <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { openAuth } = useAuth();
  const hash = useSyncExternalStore(subscribeLocation, currentHash);
  const topic = topicFromHash(hash);
  const main = useRef<HTMLElement>(null);
  const previous = useRef(topic);

  useLayoutEffect(() => {
    if (previous.current === topic) return;
    previous.current = topic;
    main.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [topic]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = topic
      ? `${topic.label} · ColWrite product tour`
      : 'ColWrite · Research writing workspace';
    return () => {
      document.title = previousTitle;
    };
  }, [topic]);

  return (
    <div className="product-tour">
      <a
        className="tour-skip"
        href="#tour-main"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="tour-header">
        <div className="tour-wrap tour-bar">
          <a className="tour-brand" href="#top" aria-label="ColWrite overview">
            <BrandLockup />
          </a>
          <nav aria-label="Site navigation">
            <a className="tour-nav-active" href="#top" aria-current="true">
              Product tour
            </a>
            <a href="/wiki/">User wiki</a>
          </nav>
          <button className="tour-signin" type="button" onClick={openAuth}>
            Sign in <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <main
        aria-labelledby="tour-title"
        id="tour-main"
        className="tour-wrap tour-main"
        ref={main}
        tabIndex={-1}
      >
        {topic ? <TopicView topic={topic} /> : <Overview />}
      </main>
      <footer className="tour-footer">
        <div className="tour-wrap">
          <span>Examples use a sample workspace. Features and data formats may change during alpha.</span>
          <a href="/wiki/">
            User wiki <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </footer>
    </div>
  );
}
