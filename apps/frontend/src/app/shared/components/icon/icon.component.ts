import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, computed } from '@angular/core';
import type { IconNode } from 'lucide';

/**
 * IconComponent
 * - Renders Lucide SVG icons by name: <app-icon name="cart" [size]="16" class="text-gray-600" />
 * - The ICONS map below contains a curated base set grouped by domain (UI, POS/eCommerce, etc.).
 * - To add a new icon:
 *   1) Import it from 'lucide' at the top (e.g., ImportName).
 *   2) Add an entry in ICONS: 'kebab-name': ImportName.
 * - You can also add aliases by mapping multiple keys to the same import (e.g., delete/trash).
 * - Explore all available icons at https://lucide.dev/icons and keep the set lean; expand on demand.
 */
// Minimal registry: add icons you use, or expand on demand
// Import a curated base icon set; add more as needed
import {
  // UI basics
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  ArrowRight, ArrowLeft, ArrowUp, ArrowDown,
  Plus, Minus, X, Check, MoreVertical, MoreHorizontal, Search,
  Edit, Trash2, Copy, Download, Upload, RefreshCw, Filter, SortAsc, SortDesc,
  Info, AlertTriangle, AlertCircle, HelpCircle, CheckCircle2, XCircle,
  Calendar, Clock, Settings as Cog, SlidersHorizontal, Sun, Moon, Monitor,
  Home, LogIn, LogOut, User, Users, UserPlus, UserCog, ShieldCheck as Shield,
  Lock, Key, Eye, EyeOff,

  // Commerce / POS
  ShoppingCart, ShoppingBasket, Store, Package, PackageOpen, Barcode, Tags, Tag,
  CreditCard, Wallet, Banknote, Receipt, Truck, Bike, Car, MapPin, Navigation,
  Printer, ScanLine, QrCode, Percent, DollarSign, Euro, PoundSterling,
  IndianRupee, JapaneseYen, Coins, PiggyBank,

  // Inventory & products
  Boxes, ClipboardList, ClipboardCheck, CheckSquare, Grid3X3, Grid,
  Layers, List, ListChecks,

  // Analytics / dashboard
  BarChart3, LineChart, PieChart, AreaChart, Activity,

  // Communication / support
  Mail, MessageSquare, Phone, Headphones, Bell,

  // Files / docs
  File, FileText, FilePlus, FileOutput, Folder, FolderOpen, Save, Undo, Redo,

  // Multitenant / org / settings
  Building2, Building, Globe, Globe2, Network, Server, Cloud,
  Link, ExternalLink, Database, Spline, Layers3,
} from 'lucide';

const ICONS: Record<string, IconNode> = {
  // --- UI basics ---
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'arrow-right': ArrowRight,
  'arrow-left': ArrowLeft,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  plus: Plus,
  add: Plus,
  minus: Minus,
  close: X,
  x: X,
  check: Check,
  'more-vertical': MoreVertical,
  'more-horizontal': MoreHorizontal,
  search: Search,
  edit: Edit,
  delete: Trash2,
  trash: Trash2,
  copy: Copy,
  download: Download,
  upload: Upload,
  refresh: RefreshCw,
  filter: Filter,
  'sort-asc': SortAsc,
  'sort-desc': SortDesc,
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  help: HelpCircle,
  success: CheckCircle2,
  'x-circle': XCircle,
  calendar: Calendar,
  clock: Clock,
  settings: Cog,
  sliders: SlidersHorizontal,
  sun: Sun,
  moon: Moon,
  monitor: Monitor,
  home: Home,
  login: LogIn,
  logout: LogOut,
  user: User,
  users: Users,
  'user-plus': UserPlus,
  'user-cog': UserCog,
  'user-shield': Shield,
  lock: Lock,
  key: Key,
  eye: Eye,
  'eye-off': EyeOff,

  // --- Commerce / POS ---
  cart: ShoppingCart,
  basket: ShoppingBasket,
  store: Store,
  package: Package,
  'package-open': PackageOpen,
  barcode: Barcode,
  tag: Tag,
  tags: Tags,
  'credit-card': CreditCard,
  wallet: Wallet,
  cash: Banknote,
  receipt: Receipt,
  truck: Truck,
  bike: Bike,
  car: Car,
  'map-pin': MapPin,
  navigation: Navigation,
  printer: Printer,
  scan: ScanLine,
  qrcode: QrCode,
  percent: Percent,
  dollar: DollarSign,
  euro: Euro,
  pound: PoundSterling,
  rupee: IndianRupee,
  yen: JapaneseYen,
  coins: Coins,
  'piggy-bank': PiggyBank,

  // --- Inventory & products ---
  boxes: Boxes,
  'clipboard-list': ClipboardList,
  'clipboard-check': ClipboardCheck,
  checklist: ListChecks,
  list: List,
  grid: Grid,
  'grid-3x3': Grid3X3,
  layers: Layers,

  // --- Analytics / dashboard ---
  'bar-chart': BarChart3,
  'line-chart': LineChart,
  'pie-chart': PieChart,
  'area-chart': AreaChart,
  activity: Activity,

  // --- Communication / support ---
  mail: Mail,
  message: MessageSquare,
  phone: Phone,
  support: Headphones,
  bell: Bell,

  // --- Files / docs ---
  file: File,
  'file-text': FileText,
  'file-plus': FilePlus,
  'file-export': FileOutput,
  folder: Folder,
  'folder-open': FolderOpen,
  save: Save,
  undo: Undo,
  redo: Redo,

  // --- Multitenant / org / settings ---
  org: Building2,
  organization: Building,
  building: Building,
  apartment: Building2,
  globe: Globe,
  'globe-2': Globe2,
  network: Network,
  server: Server,
  cloud: Cloud,
  link: Link,
  'external-link': ExternalLink,
  database: Database,
  'org-layers': Layers3,
  domains: Spline,
};

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      *ngIf="node() as n"
      [attr.viewBox]="'0 0 24 24'"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      [attr.width]="size"
      [attr.height]="size"
      [attr.stroke]="color || 'currentColor'"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      [attr.class]="cls"
      aria-hidden="true"
    >
      <ng-container *ngFor="let c of children()">
        <ng-container [ngSwitch]="c[0]">
          <path *ngSwitchCase="'path'" [attr.d]="attrs(c).d"></path>
          <circle *ngSwitchCase="'circle'" [attr.cx]="attrs(c).cx" [attr.cy]="attrs(c).cy" [attr.r]="attrs(c).r"></circle>
          <rect *ngSwitchCase="'rect'" [attr.x]="attrs(c).x" [attr.y]="attrs(c).y" [attr.width]="attrs(c).width" [attr.height]="attrs(c).height" [attr.rx]="attrs(c).rx" [attr.ry]="attrs(c).ry"></rect>
          <line *ngSwitchCase="'line'" [attr.x1]="attrs(c).x1" [attr.y1]="attrs(c).y1" [attr.x2]="attrs(c).x2" [attr.y2]="attrs(c).y2"></line>
          <polyline *ngSwitchCase="'polyline'" [attr.points]="attrs(c).points"></polyline>
          <polygon *ngSwitchCase="'polygon'" [attr.points]="attrs(c).points"></polygon>
          <ellipse *ngSwitchCase="'ellipse'" [attr.cx]="attrs(c).cx" [attr.cy]="attrs(c).cy" [attr.rx]="attrs(c).rx" [attr.ry]="attrs(c).ry"></ellipse>
        </ng-container>
      </ng-container>
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  @Input({ required: true }) name!: string;
  @Input() size: number | string = 16;
  @Input() color?: string;
  @Input('class') cls = '';

  node = computed<IconNode | null>(() => {
    const key = (this.name || '').toLowerCase();
    return ICONS[key] ?? null;
  });

  children(): any[] {
    const n = this.node();
    return (n?.[2] as any[]) ?? [];
  }
  attrs(c: any): any {
    return (c && c[1]) || {};
  }
}
