import {
  Activity, ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpDown, ArrowUpRight,
  BellPlus, BookOpen, BookOpenCheck, Bot, CalendarDays, Camera, ChartCandlestick,
  ChartColumn, ChartNoAxesCombined, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, ChevronsLeft, ChevronsRight, CircleCheck, CirclePlus, CircleX,
  ClipboardList, Clock3, CodeXml, Columns3, Compass, Copy, CreditCard, Crosshair,
  Database, Download, Ellipsis, EllipsisVertical, Expand, Eye, EyeOff, File,
  FilePenLine, FileText, Filter, Folder, GraduationCap, GripHorizontal, GripVertical,
  Hand, History, House, Info, Layers, LayoutDashboard, LayoutPanelLeft, Link,
  List, ListChecks, LockKeyhole, Maximize, Menu, MessageSquare, Minimize, Minus,
  Moon, NotebookPen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen,
  Pause, Pencil, Play, Plus, Redo2, RefreshCw, Rocket, RotateCcw, Ruler, Save,
  Search, Settings2, ShieldCheck, SkipBack, SlidersHorizontal, Sparkles, Square,
  StepForward, Sun, Table2, Tag, Tags, Target, Trash2, TriangleAlert, Type,
  Undo2, Upload, Wallet, X, Zap, ZoomIn, ZoomOut, Star,
} from 'lucide-react'

// Semantic names keep consumers independent of a vendor's naming and aliases.
const icons = {
  activity:Activity, analytics:ChartColumn, 'arrow-left':ArrowLeft, 'arrow-right':ArrowRight,
  trades:ArrowLeftRight, sort:ArrowUpDown, deposit:ArrowDownLeft, withdrawal:ArrowUpRight,
  alert:BellPlus, book:BookOpen, journal:NotebookPen, ledger:ClipboardList, bot:Bot,
  calendar:CalendarDays, clock:Clock3, camera:Camera, candles:ChartCandlestick, chart:ChartNoAxesCombined,
  check:Check, success:CircleCheck, error:CircleX, warning:TriangleAlert, info:Info, trophy:Target,
  performance:ChartNoAxesCombined,
  down:ChevronDown, up:ChevronUp, collapse:ChevronRight, expand:ChevronLeft,
  'chevron-down':ChevronDown, 'chevron-up':ChevronUp, 'chevron-left':ChevronLeft,
  'chevron-right':ChevronRight, 'chevrons-left':ChevronsLeft, 'chevrons-right':ChevronsRight,
  editor:CodeXml, columns:Columns3, compass:Compass, copy:Copy, account:CreditCard,
  cross:Crosshair, database:Database, download:Download, more:Ellipsis,
  'more-vertical':EllipsisVertical, 'expand-corners':Maximize, 'contract-corners':Minimize,
  fit:Expand, eye:Eye, 'eye-off':EyeOff, 'note-empty':File, 'note-filled':FileText,
  'note-edit':FilePenLine, document:FileText, edit:Pencil, filter:Filter, folder:Folder,
  learn:GraduationCap, grip:GripVertical, 'grip-horizontal':GripHorizontal,
  hand:Hand, history:History, 'history-restore':History, home:House,
  layers:Layers, dashboard:LayoutDashboard, layout:LayoutPanelLeft, link:Link,
  list:List, 'list-checks':ListChecks, lock:LockKeyhole, menu:Menu, comment:MessageSquare,
  minus:Minus, moon:Moon, templates:BookOpenCheck, 'panel-close':PanelRightClose,
  'panel-open':PanelRightOpen, 'panel-left-close':PanelLeftClose,
  'panel-left-open':PanelLeftOpen, pause:Pause, play:Play, plus:Plus, order:Plus,
  'place-order':CirclePlus, redo:Redo2, refresh:RefreshCw, sync:RefreshCw,
  rocket:Rocket, restore:RotateCcw, measure:Ruler, save:Save, search:Search,
  settings:Settings2, shield:ShieldCheck, back:SkipBack, sliders:SlidersHorizontal,
  mentor:Sparkles, sparkles:Sparkles, stop:Square, step:StepForward, sun:Sun,
  data:Table2, tag:Tag, tags:Tags, target:Target, trash:Trash2, delete:Trash2,
  text:Type, undo:Undo2, upload:Upload, wallet:Wallet, close:X, 'quick-search':Zap,
  'zoom-in':ZoomIn, 'zoom-out':ZoomOut, star:Star,
}

export const APP_ICON_NAMES = Object.freeze(Object.keys(icons))

export default function AppIcon({ name = 'info', size = 18, className = '', ...props }) {
  const Glyph = icons[name] || Info
  return <Glyph size={size} strokeWidth={2} aria-hidden="true" focusable="false" {...props} className={`wm-icon ${className}`.trim()} data-icon={name} />
}
