// Static copy for the home page. Every statement here describes how the platform actually behaves
// (see the backend API); there are no invented figures, people or quotes.

// FICTIONAL demo testimonials for the home page (components/Testimonials.jsx). The names, places and ratings are
// invented for design/demo purposes and are not collected from customers. Replace them with real, consented guest
// feedback before a public launch. Real reviews of a stay live on its own page and come from the API.
export const testimonials = [
  {
    id: 't1',
    featured: true,
    name: 'Divya Nair',
    trip: 'Family trip · Munnar',
    rating: 5,
    quote:
      'We took the children and both sets of grandparents for five days. The cottage had room for everyone, the beds were properly comfortable, and our host left a handwritten map of easy walks nearby. It felt like a real family holiday with nothing to sort out.',
  },
  {
    id: 't2',
    name: 'Arjun Kulkarni',
    trip: 'Weekend getaway · Goa',
    rating: 5,
    quote: 'Friday to Sunday and exactly the reset we needed. A quiet lane, a pool to ourselves and check-in that took two minutes.',
  },
  {
    id: 't3',
    name: 'Fatima Sheikh',
    trip: 'Long weekend · Jaipur',
    rating: 5,
    quote: 'Spotless from the moment we walked in: fresh linen, a gleaming kitchen and every little detail looked after.',
  },
  {
    id: 't4',
    tint: true,
    name: 'Gurpreet Bedi',
    trip: 'Mountain break · Manali',
    rating: 4,
    quote:
      'The host answered within minutes every time, sent clear directions for the hill road and suggested a café for breakfast. The towels were a little thin, but we would happily stay again.',
  },
  {
    id: 't5',
    name: 'Lakshmi Narayanan',
    trip: 'Couple’s trip · Udaipur',
    rating: 5,
    quote: 'Close enough to walk to the lake and the old market, yet calm at night. We never needed a taxi.',
  },
  {
    id: 't6',
    name: 'Rohit Deshmukh',
    trip: 'Week away · Bengaluru',
    rating: 5,
    quote:
      'Booking was simple and the total matched what I saw at checkout. Fast Wi-Fi, a proper desk and a very comfortable bed made working from here easy.',
  },
]

export const highlights = [
  {
    id: 'price',
    icon: 'receipt',
    title: 'The price you see is the price you pay',
    featured: true,
    text: 'Your total is worked out by our server from the number of nights and the nightly price at the moment you book. If a host changes the price later, your booking stays as it was.',
  },
  {
    id: 'verified',
    icon: 'mail',
    title: 'Bookings need a verified email',
    text: 'Only guests who have confirmed their email address can book, so hosts know who is on the other end.',
  },
  {
    id: 'reviews',
    icon: 'star',
    title: 'Reviews from real stays',
    tint: true,
    text: 'Only the guest of a completed stay can leave a review, and only one per booking.',
  },
  {
    id: 'hosts',
    icon: 'badge',
    title: 'Hosts pick a plan to publish',
    text: 'Anyone can start a listing as a private draft. It goes live only after the Host chooses a plan and the payment is verified.',
  },
]

export const faqs = [
  {
    q: 'How do I book a stay on Blüdhaven?',
    a: 'Search by destination, dates and guests, open a stay you like and choose your dates in the booking panel. You need a guest account with a verified email. Your total is calculated by our server and shown to you before you confirm.',
  },
  {
    q: 'Can I cancel or change my dates?',
    a: 'A booking cannot be edited. While it is pending or confirmed you can cancel it from My trips and book again with new dates, subject to availability.',
  },
  {
    q: 'What is included in the price?',
    a: 'The total is the number of nights multiplied by the stay’s nightly price, fixed when you book. Later changes to the nightly price do not affect a booking you have already made.',
  },
  {
    q: 'Are the photos and reviews real?',
    a: 'Hosts upload their own photos. Only the guest of a completed stay can leave a review, once per booking, and a stay’s rating is the average of its reviews. Stays rated 4.8 or higher show a Guest favourite badge.',
  },
  {
    q: 'How do I become a host?',
    a: 'Choose Become a host, create your Host account and describe your place with photos, amenities and a nightly price. It stays a private draft until you pick a subscription plan and the payment is verified, then you can publish it.',
  },
]
