import { describe, expect, it } from 'vitest';
import { assistantCatalog, assistantSettingsOf, resolveRunToolset, updateAccountSwitches, type AccountSwitches, type EngineGate } from './assistantCatalog';

/**
 * The mock's catalog against the API's: each expectation below is what
 * `ColWrite-api/src/agent/policy/catalog.py` answers for the same account,
 * policy, role and engine on the mock's deployment (web search, OpenAlex and
 * Semantic Scholar configured; no arXiv index, semantic retrieval or image
 * generation), computed by running the API's code. Only what is not `on` is listed; everything else
 * is `on` with no reason.
 */
/** The API's profiles and effort tiers (`assistant_catalog`'s `profiles` and `effort_rows()`). */
const SHAPE = {
  "profiles": [
    {
      "id": "chat",
      "label": "Assistant",
      "toolsets": [
        "page",
        "citations",
        "evidence",
        "library",
        "papers",
        "web",
        "pages",
        "planning",
        "delegation",
        "skills",
        "images"
      ],
      "efforts": [
        "quick",
        "standard",
        "deep"
      ],
      "default_effort": "standard"
    },
    {
      "id": "inline",
      "label": "Inline",
      "toolsets": [
        "evidence",
        "library",
        "papers",
        "web",
        "skills"
      ],
      "efforts": [
        "quick"
      ],
      "default_effort": "quick"
    },
    {
      "id": "review",
      "label": "Review",
      "toolsets": ["page", "evidence", "library", "papers", "web", "planning", "delegation", "skills"],
      "efforts": ["standard"],
      "default_effort": "standard"
    }
  ],
  "efforts": [
    {
      "id": "quick",
      "label": "Quick",
      "description": "A lookup, a small edit, any inline action.",
      "budget": {
        "model_calls": 12,
        "tool_calls": 20,
        "web_calls": 4,
        "scholarly_calls": 8,
        "workers": 0,
        "wall_clock_seconds": 300,
        "cost_limit": 1.0
      },
      "needs_plan": false,
      "cuts": [
        {
          "tool": "delegate",
          "reason": "A quick run starts no workers."
        }
      ],
      "resume": {
        "state": "unavailable",
        "reason": "Only a deep run checkpoints and can be resumed."
      }
    },
    {
      "id": "standard",
      "label": "Standard",
      "description": "A focused question, a section, a claim check.",
      "budget": {
        "model_calls": 40,
        "tool_calls": 60,
        "web_calls": 12,
        "scholarly_calls": 30,
        "workers": 3,
        "wall_clock_seconds": 1200,
        "cost_limit": 5.0
      },
      "needs_plan": false,
      "cuts": [],
      "resume": {
        "state": "unavailable",
        "reason": "Only a deep run checkpoints and can be resumed."
      }
    },
    {
      "id": "deep",
      "label": "Deep",
      "description": "A literature review, a report, a full review. Starts from a plan you approve.",
      "budget": {
        "model_calls": 120,
        "tool_calls": 200,
        "web_calls": 40,
        "scholarly_calls": 100,
        "workers": 6,
        "wall_clock_seconds": 3600,
        "cost_limit": 20.0
      },
      "needs_plan": true,
      "cuts": [],
      "resume": {
        "state": "on",
        "reason": null
      }
    }
  ],
  "workers": [
    {
      "id": "web_researcher",
      "label": "Web researcher",
      "description": "Finds out what outside sources, papers and the web, say about one question. It never sees the page.",
      "tools": [
        "evidence_read",
        "paper_search",
        "paper_get",
        "paper_graph",
        "paper_passages",
        "web_search",
        "web_read",
        "skill_read"
      ],
      "state": "off",
      "reason": "Research workers is switched off in your settings."
    },
    {
      "id": "library_reader",
      "label": "Library reader",
      "description": "Finds out what the author's own PDFs and pages say about one question. Nothing it reads leaves ColWrite.",
      "tools": [
        "doc_read",
        "evidence_read",
        "library_list",
        "library_read",
        "library_search",
        "page_search",
        "page_read",
        "skill_read"
      ],
      "state": "off",
      "reason": "Research workers is switched off in your settings."
    },
    {
      "id": "reviewer",
      "label": "Reviewer",
      "description": "Checks a drafted section against the passages it cites, with nothing else in view.",
      "tools": [
        "evidence_read"
      ],
      "state": "off",
      "reason": "Research workers is switched off in your settings."
    }
  ]
};

/**
 * What the API's `assistant_catalog` reports for each scenario, recomputed
 * against the current file-derived skill catalog.
 */
const EXPECTED: Record<string, {
  toolsets: Record<string, [string, string | null]>;
  tools: Record<string, [string, string | null]>;
  skills: Record<string, [string, string | null]>;
  presets: Record<string, [string, string | null]>;
  switches: Record<string, [string, string | null, Array<[string, string, string | null]>]>;
  workers: Record<string, [string, string | null]>;
  resume: Record<string, [string, string | null]>;
}> = {
  "personal": {
    "toolsets": {
      "delegation": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "web": [
        "off",
        "Web is switched off in your settings."
      ]
    },
    "tools": {
      "delegate": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "web_read": [
        "off",
        "Web is switched off in your settings."
      ],
      "web_search": [
        "off",
        "Web is switched off in your settings."
      ]
    },
    "presets": {},
    "skills": {},
    "workers": {
      "web_researcher": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "library_reader": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "reviewer": [
        "off",
        "Research workers is switched off in your settings."
      ]
    },
    "resume": {
      "quick": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "standard": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "deep": [
        "on",
        null
      ]
    },
    "switches": {
      "papers": [
        "on",
        null,
        [
          [
            "openalex",
            "on",
            null
          ],
          [
            "arxiv_index",
            "unavailable",
            "Not configured on this server."
          ],
          [
            "semantic_scholar",
            "on",
            null
          ]
        ]
      ],
      "web": [
        "off",
        "Switched off in your settings.",
        []
      ],
      "workers": [
        "off",
        "Switched off in your settings.",
        []
      ],
      "images": [
        "unavailable",
        "Not configured on this server.",
        []
      ]
    }
  },
  "lab": {
    "toolsets": {
      "delegation": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "papers": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "web": [
        "blocked",
        "Web search is switched off in this workspace."
      ]
    },
    "tools": {
      "delegate": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "paper_get": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "paper_graph": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "paper_passages": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "paper_search": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "web_read": [
        "blocked",
        "Web search is switched off in this workspace."
      ],
      "web_search": [
        "blocked",
        "Web search is switched off in this workspace."
      ]
    },
    "presets": {},
    "skills": {},
    "workers": {
      "web_researcher": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "library_reader": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "reviewer": [
        "off",
        "Research workers is switched off in your settings."
      ]
    },
    "resume": {
      "quick": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "standard": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "deep": [
        "on",
        null
      ]
    },
    "switches": {
      "papers": [
        "blocked",
        "Switched off in this workspace.",
        [
          [
            "openalex",
            "blocked",
            "Switched off in this workspace."
          ],
          [
            "arxiv_index",
            "unavailable",
            "Not configured on this server."
          ],
          [
            "semantic_scholar",
            "blocked",
            "Switched off in this workspace."
          ]
        ]
      ],
      "web": [
        "blocked",
        "Switched off in this workspace.",
        []
      ],
      "workers": [
        "off",
        "Switched off in your settings.",
        []
      ],
      "images": [
        "unavailable",
        "Not configured on this server.",
        []
      ]
    }
  },
  "labAllOn": {
    "toolsets": {
      "papers": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "web": [
        "blocked",
        "Web search is switched off in this workspace."
      ]
    },
    "tools": {
      "paper_get": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "paper_graph": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "paper_passages": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "paper_search": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "web_read": [
        "blocked",
        "Web search is switched off in this workspace."
      ],
      "web_search": [
        "blocked",
        "Web search is switched off in this workspace."
      ]
    },
    "presets": {},
    "skills": {},
    "workers": {
      "web_researcher": [
        "blocked",
        "Outside research is switched off in this workspace."
      ],
      "library_reader": [
        "on",
        null
      ],
      "reviewer": [
        "on",
        null
      ]
    },
    "resume": {
      "quick": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "standard": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "deep": [
        "on",
        null
      ]
    },
    "switches": {
      "papers": [
        "blocked",
        "Switched off in this workspace.",
        [
          [
            "openalex",
            "blocked",
            "Switched off in this workspace."
          ],
          [
            "arxiv_index",
            "unavailable",
            "Not configured on this server."
          ],
          [
            "semantic_scholar",
            "blocked",
            "Switched off in this workspace."
          ]
        ]
      ],
      "web": [
        "blocked",
        "Switched off in this workspace.",
        []
      ],
      "workers": [
        "on",
        null,
        []
      ],
      "images": [
        "unavailable",
        "Not configured on this server.",
        []
      ]
    }
  },
  "viewer": {
    "toolsets": {
      "citations": [
        "blocked",
        "Needs the editor role."
      ],
      "delegation": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "web": [
        "off",
        "Web is switched off in your settings."
      ]
    },
    "tools": {
      "author_ask": [
        "blocked",
        "Needs the editor role."
      ],
      "cite_sources": [
        "blocked",
        "Needs the editor role."
      ],
      "delegate": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "doc_create": [
        "blocked",
        "Needs the editor role."
      ],
      "doc_edit": [
        "blocked",
        "Needs the editor role."
      ],
      "plan_propose": [
        "blocked",
        "Needs the editor role."
      ],
      "web_read": [
        "off",
        "Web is switched off in your settings."
      ],
      "web_search": [
        "off",
        "Web is switched off in your settings."
      ]
    },
    "presets": {
      "tighten-page": [
        "blocked",
        "Needs the editor role."
      ]
    },
    "skills": {
      "citing": [
        "blocked",
        "Needs the editor role."
      ],
      "editor": [
        "blocked",
        "Needs the editor role."
      ]
    },
    "workers": {
      "web_researcher": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "library_reader": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "reviewer": [
        "off",
        "Research workers is switched off in your settings."
      ]
    },
    "resume": {
      "quick": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "standard": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "deep": [
        "on",
        null
      ]
    },
    "switches": {
      "papers": [
        "on",
        null,
        [
          [
            "openalex",
            "on",
            null
          ],
          [
            "arxiv_index",
            "unavailable",
            "Not configured on this server."
          ],
          [
            "semantic_scholar",
            "on",
            null
          ]
        ]
      ],
      "web": [
        "off",
        "Switched off in your settings.",
        []
      ],
      "workers": [
        "off",
        "Switched off in your settings.",
        []
      ],
      "images": [
        "unavailable",
        "Not configured on this server.",
        []
      ]
    }
  },
  "allon": {
    "toolsets": {},
    "tools": {},
    "presets": {},
    "skills": {},
    "workers": {
      "web_researcher": [
        "on",
        null
      ],
      "library_reader": [
        "on",
        null
      ],
      "reviewer": [
        "on",
        null
      ]
    },
    "resume": {
      "quick": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "standard": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "deep": [
        "unavailable",
        "A deep run on Codex does not checkpoint, so it cannot be resumed if it is interrupted."
      ]
    },
    "switches": {
      "papers": [
        "on",
        null,
        [
          [
            "openalex",
            "on",
            null
          ],
          [
            "arxiv_index",
            "unavailable",
            "Not configured on this server."
          ],
          [
            "semantic_scholar",
            "on",
            null
          ]
        ]
      ],
      "web": [
        "on",
        null,
        []
      ],
      "workers": [
        "on",
        null,
        []
      ],
      "images": [
        "unavailable",
        "Not configured on this server.",
        []
      ]
    }
  },
  "sourcesOff": {
    "toolsets": {
      "delegation": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "papers": [
        "off",
        "OpenAlex and Semantic Scholar are switched off in your settings."
      ],
      "web": [
        "off",
        "Web is switched off in your settings."
      ]
    },
    "tools": {
      "delegate": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "paper_get": [
        "off",
        "OpenAlex and Semantic Scholar are switched off in your settings."
      ],
      "paper_graph": [
        "off",
        "OpenAlex and Semantic Scholar are switched off in your settings."
      ],
      "paper_passages": [
        "off",
        "Semantic Scholar is switched off in your settings."
      ],
      "paper_search": [
        "off",
        "OpenAlex and Semantic Scholar are switched off in your settings."
      ],
      "web_read": [
        "off",
        "Web is switched off in your settings."
      ],
      "web_search": [
        "off",
        "Web is switched off in your settings."
      ]
    },
    "presets": {},
    "skills": {},
    "workers": {
      "web_researcher": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "library_reader": [
        "off",
        "Research workers is switched off in your settings."
      ],
      "reviewer": [
        "off",
        "Research workers is switched off in your settings."
      ]
    },
    "resume": {
      "quick": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "standard": [
        "unavailable",
        "Only a deep run checkpoints and can be resumed."
      ],
      "deep": [
        "unavailable",
        "A deep run on Claude Code does not checkpoint, so it cannot be resumed if it is interrupted."
      ]
    },
    "switches": {
      "papers": [
        "on",
        null,
        [
          [
            "openalex",
            "off",
            "Switched off in your settings."
          ],
          [
            "arxiv_index",
            "unavailable",
            "Not configured on this server."
          ],
          [
            "semantic_scholar",
            "off",
            "Switched off in your settings."
          ]
        ]
      ],
      "web": [
        "off",
        "Switched off in your settings.",
        []
      ],
      "workers": [
        "off",
        "Switched off in your settings.",
        []
      ],
      "images": [
        "unavailable",
        "Not configured on this server.",
        []
      ]
    }
  }
};

const ENGINES: EngineGate[] = [
  { id: 'gateway', label: 'ColWrite model gateway', available: true, message: '' },
  { id: 'claude', label: 'Claude Code', available: true, message: '' },
  { id: 'codex', label: 'Codex', available: false, message: 'Codex is not signed in.' },
];
/** The preview's account: the defaults (Papers with every source, Web and Workers off). */
const MOCK: AccountSwitches = { switches: {}, sources: {} };
const ALL_ON: AccountSwitches = { switches: { web: true, workers: true, images: true }, sources: {} };
const SOURCES_OFF: AccountSwitches = { switches: {}, sources: { openalex: false, semantic_scholar: false } };
const OPEN = { web_search: true, outside_research: true, auto: true, images: true };
const RESTRICTED = { web_search: false, outside_research: false, auto: true, images: true };

const SCENARIOS = {
  personal: { account: MOCK, policy: OPEN, role: 'owner', engine: 'gateway' },
  lab: { account: MOCK, policy: RESTRICTED, role: 'editor', engine: 'gateway' },
  labAllOn: { account: ALL_ON, policy: RESTRICTED, role: 'editor', engine: 'gateway' },
  viewer: { account: MOCK, policy: OPEN, role: 'viewer', engine: 'gateway' },
  allon: { account: ALL_ON, policy: OPEN, role: 'owner', engine: 'codex' },
  sourcesOff: { account: SOURCES_OFF, policy: OPEN, role: 'owner', engine: 'claude' },
} as const;

/** The catalog as `EXPECTED` lists it. */
function observed(name: keyof typeof SCENARIOS) {
  const catalog = assistantCatalog({ ...SCENARIOS[name], engines: ENGINES });
  const notOn = <T extends { id: string; state: string; reason: string | null }>(rows: T[]) =>
    Object.fromEntries(rows.filter((row) => row.state !== 'on').map((row) => [row.id, [row.state, row.reason]]));
  for (const row of [...catalog.toolsets, ...catalog.tools, ...catalog.skills, ...catalog.presets]) {
    if (row.state === 'on') expect(row.reason, row.id).toBeNull();
  }
  return {
    catalog,
    rows: {
      toolsets: notOn(catalog.toolsets),
      tools: notOn(catalog.tools),
      skills: notOn(catalog.skills),
      presets: notOn(catalog.presets),
      switches: Object.fromEntries(catalog.switches.map((row) => [
        row.id, [row.state, row.reason, row.sources.map((source) => [source.id, source.state, source.reason])],
      ])),
      workers: Object.fromEntries(catalog.workers.map((row) => [row.id, [row.state, row.reason]])),
      resume: Object.fromEntries(catalog.efforts.map((row) => [row.id, [row.resume.state, row.resume.reason]])),
    },
  };
}

describe('the mock’s assistant catalog, as the API computes it', () => {
  it('advertises eligible Web while each run narrows it, including the run’s own cut order and effort', () => {
    const rules = { account: ALL_ON, policy: OPEN, canEdit: true, engine: 'gateway' as const };
    expect(assistantCatalog({ ...SCENARIOS.allon, engines: ENGINES }).toolsets.find((row) => row.id === 'web')?.state).toBe('on');
    const off = resolveRunToolset('chat', rules, 'standard', false);
    expect(off.cuts.get('web_search')).toMatchObject({ reason: 'request', detail: 'Web is switched off for this turn.' });
    expect(off.has.has('web_search')).toBe(false);
    expect(off.has.has('paper_search')).toBe(true);
    expect(off.has.has('delegate')).toBe(true);
    expect(resolveRunToolset('chat', rules, 'standard', true).has.has('web_search')).toBe(true);
    expect(resolveRunToolset('chat', rules, 'quick', true).cuts.get('delegate')).toMatchObject({ reason: 'effort' });
    const accountAndPolicy = resolveRunToolset('chat', { ...rules, account: MOCK, policy: RESTRICTED }, 'standard', true);
    // A run reports its first cut (account), unlike the catalog's strongest
    // restriction (workspace). Both share one resolver.
    expect(accountAndPolicy.cuts.get('web_search')).toMatchObject({ reason: 'account' });
    expect(assistantCatalog({ ...SCENARIOS.lab, engines: ENGINES }).toolsets.find((row) => row.id === 'web')?.state).toBe('blocked');
  });

  for (const name of Object.keys(SCENARIOS) as Array<keyof typeof SCENARIOS>) {
    it(`reports every state and reason for ${name}`, () => {
      // P6 adds a real toolset/tool. This mock deployment still has no live
      // generator; these are the API's explicit default-off deployment rows.
      const unavailable = ['unavailable', 'Not configured on this server.'];
      expect(observed(name).rows).toEqual({
        ...EXPECTED[name],
        toolsets: { ...EXPECTED[name]!.toolsets, images: unavailable },
        tools: { ...EXPECTED[name]!.tools, image_generate: unavailable },
      });
    });
  }

  it('names the engine asked about, the role, the policy and each engine’s gate', () => {
    const { catalog } = observed('lab');
    expect(catalog).toMatchObject({ engine: 'gateway', role: 'editor', policy: RESTRICTED });
    expect(catalog.engines.map((engine) => [engine.id, engine.state, engine.reason])).toEqual([
      ['gateway', 'on', null], ['claude', 'on', null], ['codex', 'unavailable', 'Codex is not signed in.'],
    ]);
    expect(catalog.profiles.map((profile) => profile.id)).toEqual(['chat', 'inline', 'review']);
  });

  it('lists each profile’s toolsets and effort tiers, and the tiers with what each may spend', () => {
    const { catalog } = observed('personal');
    expect({ profiles: catalog.profiles, efforts: catalog.efforts, workers: catalog.workers }).toEqual({
      ...SHAPE, workers: SHAPE.workers.map((worker) => ({ ...worker, configurable: true })),
    });
    // Only the gateway checkpoints a deep run, so only it can resume one.
    expect(Object.fromEntries(catalog.engines.map((row) => [row.id, row.capabilities.checkpoints]))).toEqual({"gateway": true, "claude": false, "codex": false});
  });

  it('keeps only the account’s choices that differ from the defaults, and reports nothing blocked outside a workspace', () => {
    const changed = updateAccountSwitches(MOCK, { web: true, papers: true, sources: { semantic_scholar: false, openalex: true } });
    expect(changed).toEqual({ switches: { web: true }, sources: { semantic_scholar: false } });
    const settings = assistantSettingsOf({ switches: {}, sources: {} });
    expect(settings.switches.map((row) => [row.id, row.enabled, row.state])).toEqual([
      ['papers', true, 'on'], ['web', false, 'off'], ['workers', false, 'off'], ['images', false, 'unavailable'],
    ]);
  });
});
