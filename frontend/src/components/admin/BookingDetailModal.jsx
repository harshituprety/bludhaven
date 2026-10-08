import { useState } from "react";
import { Link } from "react-router-dom";
import Modal from "../Modal";
import Button from "../Button";
import ConfirmDialog from "../ConfirmDialog";
import FormAlert from "../FormAlert";
import { BookingStatusBadge } from "../StatusBadge";
import {
  cancelBooking,
  completeBooking,
} from "../../services/bookings";
import { placeLabel } from "../../utils/mappers";
import DetailList from "./DetailList";
import { fmtDate, fmtDateTime, fmtMoney } from "./adminFormat";
import useSubmit from "./useSubmit";

// Which actions each status allows (mirrors the API workflow; the server decides). There is no manual confirm: a booking
// becomes CONFIRMED only through a verified guest payment.
const ACTIONS = {
  complete: {
    label: "Mark completed",
    from: ["CONFIRMED"],
    run: completeBooking,
    title: "Mark this stay as completed?",
    message:
      "This is final. It is only possible once the check-out date has passed, and it lets the guest leave a review.",
    done: "Booking marked as completed.",
  },
  cancel: {
    label: "Cancel booking",
    from: ["PENDING", "CONFIRMED"],
    run: cancelBooking,
    title: "Cancel this booking?",
    message: "This is final. The dates become available to other guests again.",
    done: "Booking cancelled.",
    danger: true,
  },
};
const ERRORS = {
  invalid_transition:
    "That isn’t possible from the booking’s current status. Close this window and refresh the list.",
};

export default function BookingDetailModal({
  booking: initial,
  onClose,
  onChanged,
}) {
  const [booking, setBooking] = useState(initial);
  const [pendingAction, setPendingAction] = useState(null);
  const [notice, setNotice] = useState("");
  const action = pendingAction ? ACTIONS[pendingAction] : null;
  const { run, pending, error, reset } = useSubmit(
    (id) => ACTIONS[pendingAction].run(id),
    [],
    ERRORS,
  );

  async function confirm() {
    const res = await run(booking.id);
    if (res.ok) {
      setBooking(res.data);
      setNotice(action.done);
      setPendingAction(null);
      onChanged?.(res.data);
    }
  }
  const available = Object.entries(ACTIONS).filter(([, a]) =>
    a.from.includes(booking.status),
  );

  // The confirmation is a sibling of the modal: a nested <dialog>'s close event would otherwise reach this modal's onClose.
  return (
    <>
      <Modal open onClose={onClose} title={`Booking #${booking.id}`}>
        <div className="flex flex-col gap-5">
          <DetailList
            items={[
              {
                label: "Property",
                value: booking.property ? (
                  <Link
                    className="font-semibold text-brand underline"
                    to={`/properties/${booking.property.id}`}
                  >
                    {booking.property.title}
                  </Link>
                ) : (
                  ""
                ),
              },
              {
                label: "Where",
                value: booking.property
                  ? placeLabel(
                      booking.property.locality,
                      booking.property.destination,
                    )
                  : "",
              },
              { label: "Guest", value: booking.guest?.full_name },
              {
                label: "Status",
                value: <BookingStatusBadge status={booking.status} />,
              },
              { label: "Check-in", value: fmtDate(booking.check_in) },
              { label: "Check-out", value: fmtDate(booking.check_out) },
              { label: "Nights", value: booking.nights },
              { label: "Guests", value: booking.guests_count },
              {
                label: "Total (fixed when booked)",
                value: fmtMoney(booking.total_price),
              },
              { label: "Booked on", value: fmtDateTime(booking.created_at) },
            ]}
          />
          <FormAlert tone="success">{notice}</FormAlert>
          {available.length ? (
            <div className="flex flex-wrap gap-3 border-t border-line pt-4">
              {available.map(([key, a]) => (
                <Button
                  key={key}
                  variant="secondary"
                  onClick={() => {
                    reset();
                    setNotice("");
                    setPendingAction(key);
                  }}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">
              This booking is final, so there are no further actions.
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={Boolean(action)}
        title={action?.title}
        message={action?.message}
        confirmLabel={action?.label}
        danger={action?.danger}
        pending={pending}
        error={error}
        onConfirm={confirm}
        onClose={() => setPendingAction(null)}
      />
    </>
  );
}
