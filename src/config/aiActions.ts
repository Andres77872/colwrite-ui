import type React from 'react';
import {
  Wand2,
  CheckCircle,
  ArrowRight,
  RefreshCw,
  Minimize2,
  Maximize2,
  Languages,
  Plus,
  FileMinus,
  Search,
} from 'lucide-react';

// ── Types ──

export type AiAction =
  | 'search-for-references'
  | 'add-details'
  | 'more-concise'
  | 'improve'
  | 'grammar'
  | 'continue'
  | 'rephrase'
  | 'shorter'
  | 'longer'
  | 'translate';

export type DispatchStrategy = 'agent_chat' | 'agent_tool';

export type AiActionGroup = 'edit' | 'reference' | 'transform';

export type SupportedLanguage = {
  label: string;
  value: string; // 'en-US', 'es-MX', or '__other__' for custom input
};

export type AiActionConfig = {
  id: AiAction;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  dispatch: DispatchStrategy;
  /** For agent_tool actions — e.g. 'add_details', 'search_citations' */
  toolName?: string;
  /** For agent_chat actions — instruction prefix for the message.
   *  Translate omits this — message is constructed in the dispatcher. */
  systemPrompt?: string;
  requiresSelection: boolean;
  group: AiActionGroup;
  /** Default false — all actions visible by default */
  hidden?: boolean;
  /** Only for translate action */
  supportedLanguages?: SupportedLanguage[];
  /** Only for translate action — defaults to 'es-MX' */
  defaultLanguage?: string;
};

// ── Registry ──

export const AI_ACTION_REGISTRY: Record<AiAction, AiActionConfig> = {
  // ── agent_chat (7) ──
  improve: {
    id: 'improve',
    label: 'Improve writing',
    icon: Wand2,
    description: 'Improve the writing quality and clarity of the selected text.',
    dispatch: 'agent_chat',
    systemPrompt:
      'Improve the writing quality and clarity of the following text. Return only the improved text without explanation.',
    requiresSelection: true,
    group: 'edit',
    hidden: false,
  },

  grammar: {
    id: 'grammar',
    label: 'Fix grammar',
    icon: CheckCircle,
    description: 'Fix grammar, spelling, and punctuation errors.',
    dispatch: 'agent_chat',
    systemPrompt:
      'Fix grammar, spelling, and punctuation errors in the following text. Return only the corrected text without explanation.',
    requiresSelection: true,
    group: 'edit',
    hidden: false,
  },

  continue: {
    id: 'continue',
    label: 'Continue writing',
    icon: ArrowRight,
    description: 'Continue the selected text naturally.',
    dispatch: 'agent_chat',
    systemPrompt:
      'Continue the following text naturally, maintaining the same style and voice.',
    requiresSelection: true,
    group: 'edit',
    hidden: false,
  },

  rephrase: {
    id: 'rephrase',
    label: 'Rephrase',
    icon: RefreshCw,
    description: 'Rephrase the selected text while preserving meaning.',
    dispatch: 'agent_chat',
    systemPrompt:
      'Rephrase the following text while preserving its meaning. Return only the rephrased text without explanation.',
    requiresSelection: true,
    group: 'edit',
    hidden: false,
  },

  shorter: {
    id: 'shorter',
    label: 'Make shorter',
    icon: Minimize2,
    description: 'Make the selected text shorter and more concise.',
    dispatch: 'agent_chat',
    systemPrompt:
      'Make the following text shorter and more concise while preserving the key information. Return only the shortened text without explanation.',
    requiresSelection: true,
    group: 'edit',
    hidden: false,
  },

  longer: {
    id: 'longer',
    label: 'Make longer',
    icon: Maximize2,
    description: 'Expand the selected text with more detail.',
    dispatch: 'agent_chat',
    systemPrompt:
      'Expand and elaborate on the following text with more detail while preserving the original meaning.',
    requiresSelection: true,
    group: 'edit',
    hidden: false,
  },

  translate: {
    id: 'translate',
    label: 'Translate',
    icon: Languages,
    description: 'Translate the selected text to another language.',
    dispatch: 'agent_chat',
    // No systemPrompt — message is constructed in dispatcher as
    // "Translate the following text to {language}: {selectedText}"
    requiresSelection: true,
    group: 'transform',
    hidden: false,
    supportedLanguages: [
      { label: 'English', value: 'en-US' },
      { label: 'Spanish', value: 'es-MX' },
      { label: 'Other', value: '__other__' }, // triggers free-form text input
    ],
    defaultLanguage: 'es-MX',
  },

  // ── agent_tool (3) ──

  'add-details': {
    id: 'add-details',
    label: 'Add details',
    icon: Plus,
    description: 'Expand the selected text with the add_details tool.',
    dispatch: 'agent_tool',
    toolName: 'add_details',
    requiresSelection: true,
    group: 'edit',
    hidden: false,
  },

  'more-concise': {
    id: 'more-concise',
    label: 'Make concise',
    icon: FileMinus,
    description: 'Condense the selected text with the more_concise tool.',
    dispatch: 'agent_tool',
    toolName: 'more_concise',
    requiresSelection: true,
    group: 'edit',
    hidden: false,
  },

  'search-for-references': {
    id: 'search-for-references',
    label: 'Search references',
    icon: Search,
    description: 'Search for references related to the selected text.',
    dispatch: 'agent_tool',
    toolName: 'search_citations',
    requiresSelection: true,
    group: 'reference',
    hidden: false,
  },
};
