const express = require('express');
const { getStripe, upsertSubscriber, getSubscriberByStripeCustomer } = require('../billing');

function createWebhookRouter(bot) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      event = getStripe().webhooks.constructEvent(
        req.body, // raw Buffer — express.raw() applied in bot.js
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(bot, event.data.object);
          break;

        case 'customer.subscription.updated':
          await handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(bot, event.data.object);
          break;

        case 'invoice.payment_failed':
          await handlePaymentFailed(bot, event.data.object);
          break;
      }
    } catch (err) {
      console.error(`Stripe webhook error (${event.type}):`, err.message);
    }

    res.json({ received: true });
  });

  return router;
}

async function handleCheckoutCompleted(bot, session) {
  const telegramUserId = session.client_reference_id || session.metadata?.telegram_user_id;
  if (!telegramUserId) {
    console.error('Checkout completed but no telegram_user_id found');
    return;
  }

  const tier = session.metadata?.tier || 'pro';
  const stripeCustomerId = session.customer;
  const stripeSubscriptionId = session.subscription;

  let status = 'active';
  let trialEndsAt = null;

  if (stripeSubscriptionId) {
    try {
      const subscription = await getStripe().subscriptions.retrieve(stripeSubscriptionId);
      status = subscription.status;
      if (subscription.trial_end) {
        trialEndsAt = new Date(subscription.trial_end * 1000).toISOString();
      }
    } catch (err) {
      console.error('Failed to retrieve subscription:', err.message);
    }
  }

  await upsertSubscriber({
    telegram_user_id: Number(telegramUserId),
    telegram_username: session.metadata?.telegram_username || '',
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    subscription_tier: tier,
    subscription_status: status,
    trial_ends_at: trialEndsAt,
  });

  // Notify user via Telegram
  let message;
  if (tier === 'abyssal_active') {
    message =
      '🌊 Welcome to Abyssal Active Defense!\n\n' +
      'Your LP pools are now under active on-chain protection. ' +
      'We charge 17% commission only on verified value saved — ' +
      'nothing if we don\'t stop an attack.\n\n' +
      'Add a pool: `/abyssal watch 0x...`\n' +
      'Check status: `/abyssal alerts`';
  } else {
    const tierLabel = tier === 'pro' ? 'Pro' : 'Unlimited';
    const trialMsg = trialEndsAt
      ? `Your 7-day trial starts now. You won't be charged until ${new Date(trialEndsAt).toLocaleDateString()}.`
      : '';
    message = `🎉 Welcome to Lucid Protocol ${tierLabel}! ${trialMsg}\n\nUse /scan to start scanning. Use /usage to check your balance.`;
  }

  try {
    await bot.sendMessage(Number(telegramUserId), message, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Failed to send checkout confirmation to user:', err.message);
  }
}

async function handleSubscriptionUpdated(subscription) {
  const subscriber = await getSubscriberByStripeCustomer(subscription.customer);
  if (!subscriber) return;

  // Map Stripe price to tier
  let tier = subscriber.subscription_tier;
  const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
  const unlimitedPriceId = process.env.STRIPE_UNLIMITED_PRICE_ID;
  const abyssalActivePriceId = process.env.STRIPE_ABYSSAL_ACTIVE_PRICE_ID;

  if (subscription.items?.data?.[0]?.price?.id === proPriceId) {
    tier = 'pro';
  } else if (subscription.items?.data?.[0]?.price?.id === unlimitedPriceId) {
    tier = 'unlimited';
  } else if (subscription.items?.data?.[0]?.price?.id === abyssalActivePriceId) {
    tier = 'abyssal_active';
  }

  await upsertSubscriber({
    telegram_user_id: subscriber.telegram_user_id,
    subscription_tier: tier,
    subscription_status: subscription.status,
    trial_ends_at: subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : subscriber.trial_ends_at,
  });
}

async function handleSubscriptionDeleted(bot, subscription) {
  const subscriber = await getSubscriberByStripeCustomer(subscription.customer);
  if (!subscriber) return;

  await upsertSubscriber({
    telegram_user_id: subscriber.telegram_user_id,
    subscription_tier: 'none',
    subscription_status: 'none',
  });

  try {
    await bot.sendMessage(subscriber.telegram_user_id,
      'Your Lucid Protocol subscription has ended. You\'ll need to resubscribe to scan.\n\nType /upgrade anytime to start a new subscription.'
    );
  } catch (err) {
    console.error('Failed to notify user of subscription cancellation:', err.message);
  }
}

async function handlePaymentFailed(bot, invoice) {
  const subscriber = await getSubscriberByStripeCustomer(invoice.customer);
  if (!subscriber) return;

  await upsertSubscriber({
    telegram_user_id: subscriber.telegram_user_id,
    subscription_status: 'past_due',
  });

  try {
    await bot.sendMessage(subscriber.telegram_user_id,
      '⚠️ Your Lucid Protocol payment failed. Please update your payment method:\n\nType /manage to update your billing info.'
    );
  } catch (err) {
    console.error('Failed to notify user of payment failure:', err.message);
  }
}

module.exports = createWebhookRouter;
