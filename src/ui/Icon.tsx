// TURN-061. Named imports so the single-file build keeps only the icons we draw.
import {
  Activity, AlignHorizontalSpaceBetween, AlignLeft, AlignStartVertical, AlignVerticalSpaceBetween,
  ArrowRight, BetweenHorizontalStart, Bolt, BookOpen, BookmarkPlus, Box, BoxSelect, Cable,
  ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleHelp,
  CirclePlay, ClipboardCheck, ClipboardPaste, ClockPlus, Columns2, Compass, Copy, CopyPlus, Download,
  DraftingCompass, Expand, Eye, EyeOff, FileCode, FileInput, FileOutput, FilePlus, FlaskConical, Folder,
  Folders, GalleryHorizontalEnd, Gauge, GitFork, Hourglass, Image, ImagePlus, Keyboard, Layers,
  LayoutDashboard, LayoutGrid, LayoutTemplate, Library, ListChecks, ListOrdered, ListPlus, ListTree,
  Lock, LockKeyhole, LockKeyholeOpen, LockOpen, Map, Moon, MousePointer2, MoveHorizontal, MoveRight,
  Network, OctagonAlert, Package, PanelLeft, PanelRightOpen, Pause, PenTool, Pencil, Play, Plus, Puzzle,
  Radio, Redo2, Repeat, RotateCcw, RotateCw, Rows3, Save, Scaling, ScanSearch, Scroll, ScrollText, Search,
  SearchX, Settings, Shapes, SkipForward, SlidersHorizontal, SlidersVertical, Split, SquareStack, SquareX,
  Stethoscope, Sun, Table2, Tag, TriangleAlert, Undo2, UnfoldHorizontal, UnfoldVertical, Ungroup, Upload,
  UserRound, Workflow, X, ZoomIn, ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode, SVGProps } from 'react';
import { commandIcon, emptyIconId, ICON_PX, ICON_STROKE, type IconSize } from './icons';
import './icons.css';

export const ICONS = {
  Activity, AlignHorizontalSpaceBetween, AlignLeft, AlignStartVertical, AlignVerticalSpaceBetween,
  ArrowRight, BetweenHorizontalStart, Bolt, BookOpen, BookmarkPlus, Box, BoxSelect, Cable,
  ChevronDown, ChevronRight, CircleCheck, CircleDashed, CircleHelp,
  CirclePlay, ClipboardCheck, ClipboardPaste, ClockPlus, Columns2, Compass, Copy, CopyPlus, Download,
  DraftingCompass, Expand, Eye, EyeOff, FileCode, FileInput, FileOutput, FilePlus, FlaskConical, Folder,
  Folders, GalleryHorizontalEnd, Gauge, GitFork, Hourglass, Image, ImagePlus, Keyboard, Layers,
  LayoutDashboard, LayoutGrid, LayoutTemplate, Library, ListChecks, ListOrdered, ListPlus, ListTree,
  Lock, LockKeyhole, LockKeyholeOpen, LockOpen, Map, Moon, MousePointer2, MoveHorizontal, MoveRight,
  Network, OctagonAlert, Package, PanelLeft, PanelRightOpen, Pause, PenTool, Pencil, Play, Plus, Puzzle,
  Radio, Redo2, Repeat, RotateCcw, RotateCw, Rows3, Save, Scaling, ScanSearch, Scroll, ScrollText, Search,
  SearchX, Settings, Shapes, SkipForward, SlidersHorizontal, SlidersVertical, Split, SquareStack, SquareX,
  Stethoscope, Sun, Table2, Tag, TriangleAlert, Undo2, UnfoldHorizontal, UnfoldVertical, Ungroup, Upload,
  UserRound, Workflow, X, ZoomIn, ZoomOut,
} satisfies Record<string, LucideIcon>;

type SvgExtra = Pick<SVGProps<SVGSVGElement>, 'width' | 'height' | 'strokeWidth'>;

/** Icon for a command id. Hidden from the accessible name; the label stays on the control. */
export function AppIcon({ id, size = 'sm', width, height, strokeWidth }: { id: string; size?: IconSize } & SvgExtra) {
  const name = commandIcon(id);
  const Icon = name ? ICONS[name] : undefined;
  if (!Icon) return null;
  const px = ICON_PX[size];
  return (
    <span className={size === 'md' ? 'ecd-icon is-md' : 'ecd-icon'} data-icon={name} aria-hidden="true">
      <Icon
        stroke="currentColor"
        color="currentColor"
        strokeWidth={strokeWidth ?? ICON_STROKE}
        width={width ?? px}
        height={height ?? px}
        aria-hidden="true"
        focusable="false"
      />
    </span>
  );
}

/** Icon plus the existing words. A glyph stays in the name and in textContent, off screen. */
export function IconLabel({ id, glyph, size, children }: { id: string; glyph?: string; size?: IconSize; children?: ReactNode }) {
  return <span className="icon-host"><AppIcon id={id} size={size} />{glyph ? <span className="icon-glyph">{glyph}</span> : null}{children}</span>;
}

export function EmptyMark({ symbol }: { symbol: string }) {
  return <span className="empty-mark" aria-hidden="true"><AppIcon id={emptyIconId(symbol)} size="md" /><span className="icon-glyph">{symbol}</span></span>;
}
