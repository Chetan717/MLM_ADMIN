"use strict";
const { PaymentError, id } = require("./paymentDomain");

function createRazorpayGateway({ keyId, keySecret, fetchImpl = fetch }) {
  if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId) || !keySecret)
    throw new PaymentError(
      "failed-precondition",
      "Payment gateway is not configured.",
    );
  async function call(method, path, body) {
    // Fixed host/path; no user-controlled URL, redirects or automatic POST retry.
    try {
      const response = await fetchImpl(`https://api.razorpay.com/v1/${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok) {
        const error = new PaymentError(
          "unavailable",
          "Payment provider is temporarily unavailable. Use Check payment before trying again.",
        );
        if (
          method === "POST" &&
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408
        ) {
          error.code = "failed-precondition";
          error.message =
            "Provider rejected order creation. No checkout was opened. Refresh your quote or contact support.";
          error.definiteFailure = true;
        }
        throw error;
      }
      return data;
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      // Do not expose provider bodies, credentials, PAN, bank or customer details.
      throw new PaymentError(
        "unavailable",
        "Payment provider is temporarily unavailable. Use Check payment before trying again.",
      );
    }
  }
  return {
    keyId,
    createOrder: (purchase) =>
      call("POST", "orders", {
        amount: purchase.price.totalPaise,
        currency: "INR",
        receipt: purchase.id,
        partial_payment: false,
        notes: {
          purchaseId: purchase.id,
          ownerHash: require("./paymentDomain").hash(purchase.uid),
          companyId: purchase.companyId,
          planId: purchase.plan.planId,
        },
      }),
    fetchOrder: (orderId) => call("GET", `orders/${id(orderId)}`),
    findOrdersByReceipt: (receipt) =>
      call(
        "GET",
        `orders?receipt=${encodeURIComponent(id(receipt))}&count=100`,
      ),
    fetchPayment: (paymentId) => call("GET", `payments/${id(paymentId)}`),
    fetchOrderPayments: (orderId) =>
      call("GET", `orders/${id(orderId)}/payments`),
  };
}
module.exports = { createRazorpayGateway };
