import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { ButtonComponent } from '../button/button.component';

export interface StickyHeaderActionButton {
    id: string;
    label: string;
    variant: 'primary' | 'secondary' | 'outline' | 'outline-danger' | 'ghost' | 'danger';
    icon?: string;
    loading?: boolean;
    disabled?: boolean;
    visible?: boolean;
}

export interface StickyHeaderTab {
    id: string;
    label: string;
    shortLabel?: string;
    icon?: string;
    route?: string | unknown[];
    exact?: boolean;
    disabled?: boolean;
    visible?: boolean;
}

export type StickyHeaderVariant = 'default' | 'glass';
export type StickyHeaderBadgeColor = 'green' | 'blue' | 'yellow' | 'gray' | 'red';

@Component({
    selector: 'app-sticky-header',
    standalone: true,
    imports: [CommonModule, RouterLink, RouterLinkActive, IconComponent, ButtonComponent],
    templateUrl: './sticky-header.component.html',
    styleUrls: ['./sticky-header.component.scss'],
})
export class StickyHeaderComponent {
    title = input.required<string>();
    subtitle = input<string>('');
    icon = input<string>('box');
    variant = input<StickyHeaderVariant>('glass');
    showBackButton = input<boolean>(false);
    backRoute = input<string | string[]>('/');
    metadataContent = input<string>('');
    badgePulse = input<boolean>(false);
    badgeText = input<string>('');
    badgeColor = input<StickyHeaderBadgeColor>('blue');
    actions = input<StickyHeaderActionButton[]>([]);
    tabs = input<StickyHeaderTab[]>([]);
    activeTab = input<string>('');
    tabsAriaLabel = input<string>('Secciones');

    actionClicked = output<string>();
    tabChanged = output<string>();

    readonly visibleTabs = computed(() =>
        this.tabs().filter((tab) => tab.visible !== false),
    );

    onActionClick(id: string): void {
        this.actionClicked.emit(id);
    }

    onTabClick(tab: StickyHeaderTab, event?: Event): void {
        if (tab.disabled) {
            event?.preventDefault();
            return;
        }

        this.tabChanged.emit(tab.id);
    }

    isTabActive(tab: StickyHeaderTab, routeActive = false): boolean {
        const activeTab = this.activeTab();
        return activeTab ? activeTab === tab.id : routeActive;
    }

    getBadgeClasses(): string {
        const colors: Record<StickyHeaderBadgeColor, string> = {
            green: 'bg-green-100 text-green-700',
            blue: 'bg-blue-100 text-blue-700',
            yellow: 'bg-yellow-100 text-yellow-700',
            gray: 'bg-gray-100 text-gray-700',
            red: 'bg-red-100 text-red-700',
        };
        return colors[this.badgeColor()] || colors.blue;
    }

    getBadgeDotClasses(): string {
        const colors: Record<StickyHeaderBadgeColor, string> = {
            green: 'bg-green-500',
            blue: 'bg-blue-500',
            yellow: 'bg-yellow-500',
            gray: 'bg-gray-500',
            red: 'bg-red-500',
        };
        return colors[this.badgeColor()] || colors.blue;
    }
}
