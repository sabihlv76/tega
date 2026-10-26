import type {
  BoardStatus,
  BookingStatus,
  CapStatus,
  DocumentType,
  FareCapEnforcement,
  Locale,
  OperatorStatus,
  ParcelSize,
  ParcelStatus,
  PaymentMethod,
  PaymentState,
  PaymentStatus,
  PayoutStatus,
  PlatformSettings,
  Role,
  RouteStatus,
  TicketScanResult,
  TripStatus,
  UserStatus,
  VehicleStatus,
} from "./constants";

// API data transfer objects (JSON shapes returned by /api/v1). Dates are ISO strings.

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LocationLite {
  id: string;
  slug: string;
  name: string;
}

export interface LocationDTO extends LocationLite {
  isStation: boolean;
  district: string | null;
  province: string | null;
  aliases: string[];
  active: boolean;
}

export interface NotificationPrefs {
  sms: boolean;
  email: boolean;
  inApp: boolean;
}

export interface UserDTO {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: Role;
  status: UserStatus;
  language: Locale;
  operator: { id: string; name: string; status: OperatorStatus } | null;
  station: LocationLite | null;
  isOperatorOwner: boolean;
  notificationPrefs: NotificationPrefs;
  hasGoogle: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: UserDTO;
  isNewUser?: boolean;
  /** Only returned to mobile clients (x-fika-client: mobile). Web clients get an httpOnly cookie. */
  refreshToken?: string;
}

export interface OtpRequestResponse {
  ok: true;
  channel: "sms" | "email";
  destination: string;
  expiresIn: number;
  /** Development only, when the console SMS/email provider is active. */
  devCode?: string;
}

export interface PublicConfigDTO {
  brand: string;
  googleEnabled: boolean;
  emailOtpEnabled: boolean;
  payments: { mtn: "mock" | "live"; airtel: "mock" | "live"; cash: boolean };
  locales: Locale[];
  supportPhone: string;
  supportEmail: string;
  maxPlacesPerBooking: number;
  /** "block" rejects route prices above the RURA cap; "warn" only flags them. */
  fareCapEnforcement: FareCapEnforcement;
}

export interface OperatorLite {
  id: string;
  name: string;
  slug: string;
}

export interface VehicleLite {
  id: string;
  plateNumber: string;
  model: string | null;
  capacity: number;
}

export interface TripDTO {
  id: string;
  operator: OperatorLite;
  routeId: string;
  origin: LocationLite;
  destination: LocationLite;
  via: LocationLite[];
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  priceRwf: number;
  capRwf: number | null;
  aboveCap: boolean;
  seatsTotal: number;
  placesLeft: number;
  status: TripStatus;
  boardStatus: BoardStatus;
  delayMinutes: number;
  vehicle: VehicleLite;
}

export interface PopularRouteDTO {
  origin: LocationLite;
  destination: LocationLite;
  durationMinutes: number;
  fromPriceRwf: number;
  operators: number;
}

export interface BookingDTO {
  id: string;
  reference: string;
  status: BookingStatus;
  paymentStatus: PaymentState;
  paymentMethod: PaymentMethod | null;
  places: number;
  unitPrice: number;
  totalAmount: number;
  traveler: { name: string; phone: string; email: string | null };
  trip: TripDTO;
  holdExpiresAt: string | null;
  checkedInAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  canCancel: boolean;
  /** Operator's free-cancellation window, in hours before departure. */
  cancellationHours: number;
  /** Signed ticket token encoded in the QR code; present once the booking is confirmed. */
  qrToken: string | null;
  createdAt: string;
}

export interface PaymentDTO {
  id: string;
  kind: "booking" | "parcel";
  targetId: string;
  method: PaymentMethod;
  mode: "mock" | "live";
  phone: string | null;
  amount: number;
  status: PaymentStatus;
  failureReason: string | null;
  providerRef: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface ParcelEventDTO {
  status: ParcelStatus;
  at: string;
  station: LocationLite | null;
  note: string | null;
}

export interface ParcelDTO {
  id: string;
  code: string;
  status: ParcelStatus;
  paymentStatus: PaymentState;
  paymentMethod: PaymentMethod | null;
  origin: LocationLite;
  destination: LocationLite;
  operator: OperatorLite;
  description: string;
  weightKg: number;
  size: ParcelSize;
  priceRwf: number;
  sender: { name: string; phone: string };
  receiver: { name: string; phone: string };
  trip: { id: string; departureAt: string; status: TripStatus; plateNumber: string } | null;
  events: ParcelEventDTO[];
  /** Only visible to the sender once paid, to share with the receiver. */
  pickupCode: string | null;
  holdExpiresAt: string | null;
  createdAt: string;
}

export interface ParcelQuoteDTO {
  operator: OperatorLite;
  perKg: number;
  minimum: number;
  priceRwf: number;
  nextDeparture: string | null;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface FileRef {
  id: string;
  type: DocumentType;
  filename: string;
  contentType: string;
  size: number;
  expiresAt: string | null;
  verified: boolean;
  uploadedAt: string;
}

export interface OperatorDTO extends OperatorLite {
  registrationNumber: string;
  contactPhone: string;
  contactEmail: string | null;
  headquarters: LocationLite | null;
  status: OperatorStatus;
  statusReason: string | null;
  createdAt: string;
  approvedAt: string | null;
  bankAccount: { bankName: string; accountName: string; accountNumberMasked: string } | null;
  parcelPricing: { enabled: boolean; perKg: number; minimum: number };
  cancellationHours: number;
  commissionRate: number;
  documents: FileRef[];
}

export interface OperatorSummaryDTO extends OperatorDTO {
  stats: {
    routes: number;
    vehicles: number;
    tripsToday: number;
    bookings30d: number;
    revenue30d: number;
    capViolations: number;
  };
}

export interface RouteDTO {
  id: string;
  operator: OperatorLite;
  origin: LocationLite;
  destination: LocationLite;
  via: LocationLite[];
  distanceKm: number | null;
  durationMinutes: number;
  priceRwf: number;
  capRwf: number | null;
  capStatus: CapStatus;
  status: RouteStatus;
  pausedReason: string | null;
  tripsPerDay: number;
  createdAt: string;
}

export interface VehicleDTO extends VehicleLite {
  status: VehicleStatus;
  documents: FileRef[];
  createdAt: string;
}

export interface ScheduleDTO {
  id: string;
  route: { id: string; origin: LocationLite; destination: LocationLite; priceRwf: number };
  vehicle: VehicleLite;
  departureTime: string;
  daysOfWeek: number[];
  active: boolean;
}

export interface ManifestBookingDTO {
  id: string;
  reference: string;
  travelerName: string;
  travelerPhone: string;
  places: number;
  totalAmount: number;
  status: BookingStatus;
  paymentStatus: PaymentState;
  paymentMethod: PaymentMethod | null;
  checkedInAt: string | null;
  createdAt: string;
  trip: { id: string; departureAt: string; origin: LocationLite; destination: LocationLite; plateNumber: string };
}

export interface FareCapDTO {
  id: string;
  origin: LocationLite;
  destination: LocationLite;
  via: LocationLite | null;
  capRwf: number;
  distanceKm: number | null;
  effectiveFrom: string;
  source: "rura_registry" | "manual" | "import";
  corridor: string | null;
  operators: number;
  violations: number;
}

export interface CapViolationDTO {
  routeId: string;
  operator: OperatorLite;
  origin: LocationLite;
  destination: LocationLite;
  priceRwf: number;
  capRwf: number;
  status: RouteStatus;
}

export interface FareCapListDTO {
  items: FareCapDTO[];
  /** Number of caps on record (the list is filtered and capped at 300 rows). */
  total: number;
  violations: CapViolationDTO[];
}

export interface PayoutDTO {
  id: string;
  operator: OperatorLite;
  periodStart: string;
  periodEnd: string;
  gross: number;
  onlineGross: number;
  cashGross: number;
  commission: number;
  net: number;
  status: PayoutStatus;
  dueDate: string;
  processedAt: string | null;
  bankAccountMasked: string | null;
  reference: string | null;
  failureReason: string | null;
}

export interface BoardItemDTO {
  tripId: string;
  departureAt: string;
  scheduledAt: string;
  origin: LocationLite;
  destination: LocationLite;
  via: LocationLite[];
  durationMinutes: number;
  operatorName: string;
  plateNumber: string;
  status: BoardStatus;
  delayMinutes: number;
}

export interface BoardDTO {
  station: LocationLite;
  date: string;
  items: BoardItemDTO[];
  remaining: number;
}

export interface CheckInResultDTO {
  result: TicketScanResult;
  booking: ManifestBookingDTO | null;
  amountDue: number;
}

export interface StationTripDTO {
  id: string;
  departureAt: string;
  scheduledAt: string;
  origin: LocationLite;
  destination: LocationLite;
  operator: OperatorLite;
  plateNumber: string;
  seatsTotal: number;
  booked: number;
  checkedIn: number;
  status: TripStatus;
  boardStatus: BoardStatus;
  delayMinutes: number;
  parcels: number;
}

export interface StationTripDetailDTO {
  trip: StationTripDTO;
  passengers: ManifestBookingDTO[];
  /** Parcels already on this bus. */
  parcels: StationParcelDTO[];
  /** Parcels received at this station for the same operator and destination, ready to load. */
  loadable: StationParcelDTO[];
}

export interface StationParcelDTO {
  id: string;
  code: string;
  status: ParcelStatus;
  paymentStatus: PaymentState;
  origin: LocationLite;
  destination: LocationLite;
  operator: OperatorLite;
  description: string;
  weightKg: number;
  size: ParcelSize;
  priceRwf: number;
  receiverName: string;
  receiverPhone: string;
  senderName: string;
  tripId: string | null;
}

export interface StationParcelsDTO {
  toReceive: StationParcelDTO[];
  toLoad: StationParcelDTO[];
  toRelease: StationParcelDTO[];
}

export interface TrendPoint {
  label: string;
  value: number;
}

export interface OperatorDashboardDTO {
  date: string;
  bookingsToday: number;
  bookingsChange: number | null;
  revenueToday: number;
  revenueChange: number | null;
  activeVehicles: number;
  totalVehicles: number;
  parcelsInTransit: number;
  parcelsPendingPickup: number;
  upcomingDepartures: StationTripDTO[];
  recentBookings: ManifestBookingDTO[];
  capViolations: number;
}

export interface OperatorRevenueDTO {
  period: "week" | "month" | "year";
  gross: number;
  online: number;
  cash: number;
  commission: number;
  net: number;
  parcels: number;
  series: TrendPoint[];
  byRoute: { route: string; bookings: number; gross: number }[];
  payouts: PayoutDTO[];
  commissionRate: number;
  payoutCycleDays: number;
}

export interface StationDashboardDTO {
  station: LocationLite;
  date: string;
  departuresToday: number;
  passengersCheckedIn: number;
  passengersBooked: number;
  parcelsToLoad: number;
  parcelsToRelease: number;
  nextDepartures: StationTripDTO[];
}

export interface AdminDashboardDTO {
  operators: { total: number; pending: number; suspended: number };
  passengers: number;
  bookingsToday: number;
  revenueToday: number;
  commissionToday: number;
  parcelsInTransit: number;
  capViolations: number;
  pendingPayouts: number;
  series: TrendPoint[];
  recentActivity: AuditLogDTO[];
  pendingOperators: OperatorDTO[];
}

export interface AdminRevenueDTO {
  period: "week" | "month" | "year";
  gross: number;
  grossChange: number | null;
  commission: number;
  commissionChange: number | null;
  commissionRate: number;
  parcelRevenue: number;
  parcelChange: number | null;
  pendingPayouts: number;
  operatorsDueThisWeek: number;
  series: TrendPoint[];
  byOperator: { operator: OperatorLite; commission: number; gross: number }[];
  upcomingPayouts: PayoutDTO[];
}

export interface AuditLogDTO {
  id: string;
  actor: { id: string; name: string | null; role: Role } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  ip: string | null;
  createdAt: string;
}

export interface AdminUserDTO extends UserDTO {
  bookings: number;
}

export interface AdminOperatorDetailDTO {
  operator: OperatorSummaryDTO;
  routes: RouteDTO[];
  vehicles: VehicleDTO[];
  staff: UserDTO[];
}

export type SettingsDTO = PlatformSettings;
