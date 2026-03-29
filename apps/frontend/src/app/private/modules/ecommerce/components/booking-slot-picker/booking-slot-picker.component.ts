import { Component, OnInit, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../../environments/environment';

export interface AvailabilitySlot {
    date: string;
    start_time: string;
    end_time: string;
    available: number;
}

@Component({
    selector: 'app-booking-slot-picker',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './booking-slot-picker.component.html',
    styleUrls: ['./booking-slot-picker.component.scss'],
})
export class BookingSlotPickerComponent implements OnInit {
    readonly productId = input.required<number>();
    readonly productName = input<string>('');
    readonly serviceDuration = input<number>(60);

    slotSelected = output<{ date: string; start_time: string; end_time: string }>();

    private http = inject(HttpClient);
    private domainService = inject(TenantFacade);

    availableSlots: AvailabilitySlot[] = [];
    selectedDate: string = '';
    selectedSlot: AvailabilitySlot | null = null;
    loading = false;
    errorLoading = false;

    availableDates: string[] = [];
    slotsForSelectedDate: AvailabilitySlot[] = [];

    ngOnInit() {
        this.generateDates();
        this.loadAvailability();
    }

    private getHeaders(): HttpHeaders {
        const domainConfig = this.domainService.getCurrentDomainConfig();
        const storeId = domainConfig?.store_id;
        return new HttpHeaders({
            'x-store-id': storeId?.toString() || '',
        });
    }

    private generateDates() {
        const dates: string[] = [];
        const today = new Date();
        for (let i = 1; i <= 14; i++) {
            const date = new Date(today);
            date.setDate(date.getDate() + i);
            dates.push(date.toISOString().split('T')[0]);
        }
        this.availableDates = dates;
    }

    private loadAvailability() {
        this.loading = true;
        this.errorLoading = false;
        const dateFrom = this.availableDates[0];
        const dateTo = this.availableDates[this.availableDates.length - 1];

        this.http
            .get<any>(`${environment.apiUrl}/ecommerce/reservations/availability/${this.productId()}`, {
                params: { date_from: dateFrom, date_to: dateTo },
                headers: this.getHeaders(),
            })
            .subscribe({
                next: (response) => {
                    this.availableSlots = response.data || response || [];
                    this.loading = false;
                    // Auto-select first date that has slots
                    if (this.availableSlots.length > 0) {
                        const firstAvailableDate = this.availableSlots.find(s => s.available > 0)?.date;
                        if (firstAvailableDate) {
                            this.selectDate(firstAvailableDate);
                        }
                    }
                },
                error: () => {
                    this.loading = false;
                    this.errorLoading = true;
                },
            });
    }

    selectDate(date: string) {
        this.selectedDate = date;
        this.selectedSlot = null;
        this.slotsForSelectedDate = this.availableSlots.filter(
            (s) => s.date === date && s.available > 0,
        );
    }

    selectSlot(slot: AvailabilitySlot) {
        this.selectedSlot = slot;
        this.slotSelected.emit({
            date: slot.date,
            start_time: slot.start_time,
            end_time: slot.end_time,
        });
    }

    formatDate(dateStr: string): string {
        const date = new Date(dateStr + 'T12:00:00');
        const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
    }

    formatTime(time: string): string {
        const [hours, minutes] = time.split(':');
        const h = parseInt(hours, 10);
        const suffix = h >= 12 ? 'PM' : 'AM';
        const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `${displayH}:${minutes} ${suffix}`;
    }

    hasAvailableSlotsForDate(date: string): boolean {
        return this.availableSlots.some((s) => s.date === date && s.available > 0);
    }

    retryLoad() {
        this.loadAvailability();
    }
}
