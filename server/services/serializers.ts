import type { Types } from "mongoose";
import type {
  BoardStatus,
  BookingStatus,
  CapStatus,
  DocumentType,
  Locale,
  OperatorStatus,
  ParcelSize,
  ParcelStatus,
  PaymentMethod,
  PaymentState,
  PaymentStatus,
  PayoutStatus,
  Role,
  RouteStatus,
  TripStatus,
  UserStatus,
  VehicleStatus,
} from "../../shared/constants";
import type {
  AuditLogDTO,
  BookingDTO,
  FileRef,
  ManifestBookingDTO,
  NotificationDTO,
  OperatorDTO,
  ParcelDTO,
  PaymentDTO,
  PayoutDTO,
  RouteDTO,
  ScheduleDTO,
  StationParcelDTO,
  StationTripDTO,
  TripDTO,
  UserDTO,
  VehicleDTO,
} from "../../shared/types";
import { decrypt, maskAccount, signTicket } from "../lib/crypto";
import type { Booking, FileObject, Operator, Parcel, Payment, Payout, Route, Schedule, Trip, User, Vehicle } from "../models";
import { loc, locOrNull, op } from "./lookup";

// Converts database documents into the API shapes defined in shared/types.ts.

type WithId<T> = T & { _id: Types.ObjectId; createdAt?: Date; updatedAt?: Date };

const iso = (d: Date | null | undefined): string | null => (d ? new Date(d).toISOString() : null);
const id = (v: Types.ObjectId | null | undefined): string => (v ? v.toString() : "");

export function effectiveDeparture(trip: { departureAt: Date; delayMinutes?: number | null }): Date {
  return new Date(new Date(trip.departureAt).getTime() + (trip.delayMinutes ?? 0) * 60_000);
}

export function deriveBoardStatus(trip: { status: string; delayMinutes?: number | null }): BoardStatus {
  switch (trip.status as TripStatus) {
    case "cancelled":
      return "cancelled";
    case "arrived":
      return "arrived";
    case "departed":
      return "departed";
    case "boarding":
      return "boarding";
    default:
      return (trip.delayMinutes ?? 0) > 0 ? "delayed" : "on_time";
  }
}

export function tripDTO(trip: WithId<Trip>): TripDTO {
  const departure = effectiveDeparture(trip);
  return {
    id: trip._id.toString(),
    operator: op(trip.operatorId),
    routeId: id(trip.routeId),
    origin: loc(trip.originId),
    destination: loc(trip.destinationId),
    via: (trip.viaIds ?? []).map((v) => loc(v)),
    departureAt: departure.toISOString(),
    arrivalAt: new Date(departure.getTime() + trip.durationMinutes * 60_000).toISOString(),
    durationMinutes: trip.durationMinutes,
    priceRwf: trip.priceRwf,
    capRwf: trip.capRwf ?? null,
    aboveCap: trip.capRwf != null && trip.priceRwf > trip.capRwf,
    seatsTotal: trip.seatsTotal,
    placesLeft: Math.max(0, trip.seatsTotal - trip.seatsBooked),
    status: trip.status as TripStatus,
    boardStatus: deriveBoardStatus(trip),
    delayMinutes: trip.delayMinutes ?? 0,
    vehicle: { id: id(trip.vehicleId), plateNumber: trip.plateNumber, model: trip.vehicleModel ?? null, capacity: trip.seatsTotal },
  };
}

export function userDTO(
  user: WithId<User>,
  extra: { operator?: { _id: Types.ObjectId; name: string; status: string } | null } = {},
): UserDTO {
  return {
    id: user._id.toString(),
    name: user.name ?? null,
    phone: user.phone ?? null,
    email: user.email ?? null,
    role: user.role as Role,
    status: user.status as UserStatus,
    language: user.language as Locale,
    operator: extra.operator
      ? { id: extra.operator._id.toString(), name: extra.operator.name, status: extra.operator.status as OperatorStatus }
      : null,
    station: locOrNull(user.stationId),
    isOperatorOwner: !!user.isOperatorOwner,
    notificationPrefs: {
      sms: user.notificationPrefs?.sms ?? true,
      email: user.notificationPrefs?.email ?? true,
      inApp: user.notificationPrefs?.inApp ?? true,
    },
    hasGoogle: !!user.googleId,
    createdAt: iso(user.createdAt) ?? new Date().toISOString(),
    lastLoginAt: iso(user.lastLoginAt),
  };
}

export function canCancelBooking(
  booking: { status: string; departureAt: Date },
  trip: { status: string } | null,
  cancellationHours: number,
  now = new Date(),
): boolean {
  if (booking.status === "pending_payment") return true;
  if (booking.status !== "confirmed") return false;
  if (trip && trip.status !== "scheduled") return false;
  return new Date(booking.departureAt).getTime() - now.getTime() >= cancellationHours * 60 * 60_000;
}

export function bookingDTO(booking: WithId<Booking>, trip: WithId<Trip>, cancellationHours: number): BookingDTO {
  return {
    id: booking._id.toString(),
    reference: booking.reference,
    status: booking.status as BookingStatus,
    paymentStatus: booking.paymentStatus as PaymentState,
    paymentMethod: (booking.paymentMethod as PaymentMethod | null) ?? null,
    places: booking.places,
    unitPrice: booking.unitPrice,
    totalAmount: booking.totalAmount,
    traveler: {
      name: booking.traveler.name,
      phone: booking.traveler.phone,
      email: booking.traveler.email ?? null,
    },
    trip: tripDTO(trip),
    holdExpiresAt: iso(booking.holdExpiresAt),
    checkedInAt: iso(booking.checkedInAt),
    cancelledAt: iso(booking.cancelledAt),
    cancelReason: booking.cancelReason ?? null,
    canCancel: canCancelBooking(booking, trip, cancellationHours),
    cancellationHours,
    qrToken: booking.status === "confirmed" || booking.status === "completed" ? signTicket(booking._id.toString()) : null,
    createdAt: iso(booking.createdAt) ?? new Date().toISOString(),
  };
}

export function manifestBookingDTO(booking: WithId<Booking>, trip: WithId<Trip> | null): ManifestBookingDTO {
  return {
    id: booking._id.toString(),
    reference: booking.reference,
    travelerName: booking.traveler.name,
    travelerPhone: booking.traveler.phone,
    places: booking.places,
    totalAmount: booking.totalAmount,
    status: booking.status as BookingStatus,
    paymentStatus: booking.paymentStatus as PaymentState,
    paymentMethod: (booking.paymentMethod as PaymentMethod | null) ?? null,
    checkedInAt: iso(booking.checkedInAt),
    createdAt: iso(booking.createdAt) ?? new Date().toISOString(),
    trip: {
      id: id(booking.tripId),
      departureAt: (trip ? effectiveDeparture(trip) : booking.departureAt).toISOString(),
      origin: loc(booking.originId),
      destination: loc(booking.destinationId),
      plateNumber: trip?.plateNumber ?? "",
    },
  };
}

export function paymentDTO(payment: WithId<Payment>): PaymentDTO {
  return {
    id: payment._id.toString(),
    kind: payment.kind as "booking" | "parcel",
    targetId: id(payment.kind === "booking" ? payment.bookingId : payment.parcelId),
    method: payment.method as PaymentMethod,
    mode: payment.mode as "mock" | "live",
    phone: payment.phone ?? null,
    amount: payment.amount,
    status: payment.status as PaymentStatus,
    failureReason: payment.failureReason ?? null,
    providerRef: payment.providerRef ?? null,
    createdAt: iso(payment.createdAt) ?? new Date().toISOString(),
    paidAt: iso(payment.paidAt),
  };
}

export function parcelDTO(parcel: WithId<Parcel>, trip: WithId<Trip> | null, forSender: boolean): ParcelDTO {
  const paid = parcel.status !== "pending_payment" && parcel.status !== "expired" && parcel.status !== "cancelled";
  return {
    id: parcel._id.toString(),
    code: parcel.code,
    status: parcel.status as ParcelStatus,
    paymentStatus: parcel.paymentStatus as PaymentState,
    paymentMethod: (parcel.paymentMethod as PaymentMethod | null) ?? null,
    origin: loc(parcel.originId),
    destination: loc(parcel.destinationId),
    operator: op(parcel.operatorId),
    description: parcel.description,
    weightKg: parcel.weightKg,
    size: parcel.size as ParcelSize,
    priceRwf: parcel.priceRwf,
    sender: { name: parcel.sender.name, phone: forSender ? parcel.sender.phone : maskPhone(parcel.sender.phone) },
    receiver: {
      name: parcel.receiver.name,
      phone: forSender ? parcel.receiver.phone : maskPhone(parcel.receiver.phone),
    },
    trip: trip
      ? {
          id: trip._id.toString(),
          departureAt: effectiveDeparture(trip).toISOString(),
          status: trip.status as TripStatus,
          plateNumber: trip.plateNumber,
        }
      : null,
    events: (parcel.events ?? []).map((e) => ({
      status: e.status as ParcelStatus,
      at: iso(e.at) ?? "",
      station: locOrNull(e.stationId),
      note: e.note ?? null,
    })),
    pickupCode: forSender && paid ? decrypt(parcel.pickupCodeEnc) : null,
    holdExpiresAt: iso(parcel.holdExpiresAt),
    createdAt: iso(parcel.createdAt) ?? new Date().toISOString(),
  };
}

export function stationParcelDTO(parcel: WithId<Parcel>): StationParcelDTO {
  return {
    id: parcel._id.toString(),
    code: parcel.code,
    status: parcel.status as ParcelStatus,
    paymentStatus: parcel.paymentStatus as PaymentState,
    origin: loc(parcel.originId),
    destination: loc(parcel.destinationId),
    operator: op(parcel.operatorId),
    description: parcel.description,
    weightKg: parcel.weightKg,
    size: parcel.size as ParcelSize,
    priceRwf: parcel.priceRwf,
    receiverName: parcel.receiver.name,
    receiverPhone: parcel.receiver.phone,
    senderName: parcel.sender.name,
    tripId: parcel.tripId ? parcel.tripId.toString() : null,
  };
}

export function maskPhone(phone: string): string {
  return phone.length > 7 ? `${phone.slice(0, 7)}•••${phone.slice(-3)}` : phone;
}

export function fileRef(
  entry: { _id?: Types.ObjectId; type: string; fileId: Types.ObjectId; expiresAt?: Date | null; verified?: boolean; uploadedAt?: Date },
  file: WithId<FileObject> | undefined,
): FileRef {
  return {
    id: entry.fileId.toString(),
    type: entry.type as DocumentType,
    filename: file?.filename ?? "document",
    contentType: file?.contentType ?? "application/octet-stream",
    size: file?.size ?? 0,
    expiresAt: iso(entry.expiresAt),
    verified: !!entry.verified,
    uploadedAt: iso(entry.uploadedAt) ?? new Date().toISOString(),
  };
}

export function operatorDTO(
  operator: WithId<Operator>,
  files: Map<string, WithId<FileObject>>,
  platformRate: number,
): OperatorDTO {
  return {
    id: operator._id.toString(),
    name: operator.name,
    slug: operator.slug,
    registrationNumber: operator.registrationNumber,
    contactPhone: operator.contactPhone,
    contactEmail: operator.contactEmail ?? null,
    headquarters: locOrNull(operator.headquartersId),
    status: operator.status as OperatorStatus,
    statusReason: operator.statusReason ?? null,
    createdAt: iso(operator.createdAt) ?? new Date().toISOString(),
    approvedAt: iso(operator.approvedAt),
    bankAccount: operator.bankAccount
      ? {
          bankName: operator.bankAccount.bankName,
          accountName: operator.bankAccount.accountName,
          accountNumberMasked: maskAccount(operator.bankAccount.accountNumber) ?? "",
        }
      : null,
    parcelPricing: {
      enabled: operator.parcelPricing?.enabled ?? true,
      perKg: operator.parcelPricing?.perKg ?? 1000,
      minimum: operator.parcelPricing?.minimum ?? 1000,
    },
    cancellationHours: operator.cancellationHours ?? 2,
    commissionRate: operator.commissionRate ?? platformRate,
    documents: (operator.documents ?? []).map((d) => fileRef(d, files.get(d.fileId.toString()))),
  };
}

export function routeDTO(route: WithId<Route>, tripsPerDay = 0): RouteDTO {
  return {
    id: route._id.toString(),
    operator: op(route.operatorId),
    origin: loc(route.originId),
    destination: loc(route.destinationId),
    via: (route.viaIds ?? []).map((v) => loc(v)),
    distanceKm: route.distanceKm ?? null,
    durationMinutes: route.durationMinutes,
    priceRwf: route.priceRwf,
    capRwf: route.capRwf ?? null,
    capStatus: route.capStatus as CapStatus,
    status: route.status as RouteStatus,
    pausedReason: route.pausedReason ?? null,
    tripsPerDay,
    createdAt: iso(route.createdAt) ?? new Date().toISOString(),
  };
}

export function vehicleDTO(vehicle: WithId<Vehicle>, files: Map<string, WithId<FileObject>>): VehicleDTO {
  return {
    id: vehicle._id.toString(),
    plateNumber: vehicle.plateNumber,
    model: vehicle.model ?? null,
    capacity: vehicle.capacity,
    status: vehicle.status as VehicleStatus,
    documents: (vehicle.documents ?? []).map((d) => fileRef(d, files.get(d.fileId.toString()))),
    createdAt: iso(vehicle.createdAt) ?? new Date().toISOString(),
  };
}

export function scheduleDTO(schedule: WithId<Schedule>, route: WithId<Route> | undefined, vehicle: WithId<Vehicle> | undefined): ScheduleDTO {
  return {
    id: schedule._id.toString(),
    route: {
      id: id(schedule.routeId),
      origin: loc(route?.originId),
      destination: loc(route?.destinationId),
      priceRwf: route?.priceRwf ?? 0,
    },
    vehicle: {
      id: id(schedule.vehicleId),
      plateNumber: vehicle?.plateNumber ?? "—",
      model: vehicle?.model ?? null,
      capacity: vehicle?.capacity ?? 0,
    },
    departureTime: schedule.departureTime,
    daysOfWeek: [...(schedule.daysOfWeek ?? [])].sort(),
    active: schedule.active,
  };
}

export function stationTripDTO(trip: WithId<Trip>, parcels = 0): StationTripDTO {
  return {
    id: trip._id.toString(),
    departureAt: effectiveDeparture(trip).toISOString(),
    scheduledAt: new Date(trip.departureAt).toISOString(),
    origin: loc(trip.originId),
    destination: loc(trip.destinationId),
    operator: op(trip.operatorId),
    plateNumber: trip.plateNumber,
    seatsTotal: trip.seatsTotal,
    booked: trip.seatsBooked,
    checkedIn: trip.checkedInCount ?? 0,
    status: trip.status as TripStatus,
    boardStatus: deriveBoardStatus(trip),
    delayMinutes: trip.delayMinutes ?? 0,
    parcels,
  };
}

export function payoutDTO(payout: WithId<Payout>): PayoutDTO {
  return {
    id: payout._id.toString(),
    operator: op(payout.operatorId),
    periodStart: iso(payout.periodStart) ?? "",
    periodEnd: iso(payout.periodEnd) ?? "",
    gross: payout.gross,
    onlineGross: payout.onlineGross,
    cashGross: payout.cashGross,
    commission: payout.commission,
    net: payout.net,
    status: payout.status as PayoutStatus,
    dueDate: iso(payout.dueDate) ?? "",
    processedAt: iso(payout.processedAt),
    bankAccountMasked: payout.bankAccountMasked ?? null,
    reference: payout.reference ?? null,
    failureReason: payout.failureReason ?? null,
  };
}

export function notificationDTO(n: {
  _id: Types.ObjectId;
  type: string;
  title: string;
  body: string;
  data?: unknown;
  readAt?: Date | null;
  createdAt?: Date;
}): NotificationDTO {
  return {
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    body: n.body,
    data: (n.data as Record<string, unknown> | null) ?? null,
    readAt: iso(n.readAt),
    createdAt: iso(n.createdAt) ?? new Date().toISOString(),
  };
}

export function auditLogDTO(
  log: {
    _id: Types.ObjectId;
    actorId?: Types.ObjectId | null;
    actorRole?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    summary?: string | null;
    ip?: string | null;
    createdAt?: Date;
  },
  actors: Map<string, { name: string | null; role: string }>,
): AuditLogDTO {
  const actor = log.actorId ? actors.get(log.actorId.toString()) : undefined;
  return {
    id: log._id.toString(),
    actor: log.actorId ? { id: log.actorId.toString(), name: actor?.name ?? null, role: (actor?.role ?? log.actorRole) as Role } : null,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId ?? null,
    summary: log.summary ?? null,
    ip: log.ip ?? null,
    createdAt: iso(log.createdAt) ?? new Date().toISOString(),
  };
}
