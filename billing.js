const Stripe = require('stripe');
const { getSupabase } = require('./database');

let stripe = null;

function getStripe() {
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

const TIER_PRICES = {
  pro: () => process.env.STRIPE_PRO_PRICE_ID,
  unlimited: () => process.env.STRIPE_UNLIMITED_PRICE_ID,
  abyssal_active: () => process.env.STRIPE_ABYSSAL_ACTIVE_PRICE_ID,
};

async function createCheckoutSession(telegramUserId, telegramUsername, tier) {
  const priceId = TIER_PRICES[tier]?.();
  if (!priceId) throw new Error(`Invalid tier: ${tier}`);

  const baseUrl = process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}`;

  const params = {
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: String(telegramUserId),
    metadata: {
      telegram_user_id: String(telegramUserId),
      telegram_username: telegramUsername || '',
      tier,
    },
    success_url: `${baseUrl}/payment-success`,
    cancel_url: `${baseUrl}/payment-cancel`,
  };

  // Abyssal Active Defense: no free trial (commission-based, only charge on save)
  // Lucid Protocol tiers: 7-day trial
  if (tier === 'abyssal_active') {
    params.subscription_data = {
      // No free trial — user pays $0 unless value is saved
      // The $0 subscription is a placeholder for commission tracking.
      // Real billing happens via commission_transactions.
    };
  } else {
    params.subscription_data = { trial_period_days: 7 };
  }

  const session = await getStripe().checkout.sessions.create(params);
  return session;
}

async function createPortalSession(stripeCustomerId) {
  const baseUrl = process.env.WEBHOOK_URL || `http://localhost:${process.env.PORT || 3000}`;

  const session = await getStripe().billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: baseUrl,
  });

  return session;
}

async function getSubscriberTier(telegramUserId) {
  try {
    const { data, error } = await getSupabase()
      .from('subscribers')
      .select('*')
      .eq('telegram_user_id', telegramUserId)
      .single();

    if (error && error.code === 'PGRST116') {
      return { tier: 'none', status: 'none', stripeCustomerId: null, trialEndsAt: null };
    }
    if (error) throw error;

    return {
      tier: data.subscription_tier,
      status: data.subscription_status,
      stripeCustomerId: data.stripe_customer_id,
      trialEndsAt: data.trial_ends_at,
    };
  } catch (err) {
    console.error('Failed to get subscriber tier:', err.message);
    return { tier: 'none', status: 'none', stripeCustomerId: null, trialEndsAt: null };
  }
}

async function upsertSubscriber(data) {
  try {
    const record = {
      telegram_user_id: data.telegram_user_id,
      updated_at: new Date().toISOString(),
    };

    if (data.telegram_username !== undefined) record.telegram_username = data.telegram_username;
    if (data.stripe_customer_id !== undefined) record.stripe_customer_id = data.stripe_customer_id;
    if (data.stripe_subscription_id !== undefined) record.stripe_subscription_id = data.stripe_subscription_id;
    if (data.subscription_tier !== undefined) record.subscription_tier = data.subscription_tier;
    if (data.subscription_status !== undefined) record.subscription_status = data.subscription_status;
    if (data.trial_ends_at !== undefined) record.trial_ends_at = data.trial_ends_at;

    const { error } = await getSupabase()
      .from('subscribers')
      .upsert(record, { onConflict: 'telegram_user_id' });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Failed to upsert subscriber:', err.message);
    return false;
  }
}

async function getSubscriberByStripeCustomer(stripeCustomerId) {
  try {
    const { data, error } = await getSupabase()
      .from('subscribers')
      .select('*')
      .eq('stripe_customer_id', stripeCustomerId)
      .single();

    if (error) return null;
    return data;
  } catch (err) {
    console.error('Failed to get subscriber by Stripe customer:', err.message);
    return null;
  }
}

module.exports = {
  getStripe,
  createCheckoutSession,
  createPortalSession,
  getSubscriberTier,
  upsertSubscriber,
  getSubscriberByStripeCustomer,
};
