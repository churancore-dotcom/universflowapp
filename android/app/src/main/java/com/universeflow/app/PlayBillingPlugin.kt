package com.universeflow.app

import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "PlayBilling")
class PlayBillingPlugin : Plugin(), com.android.billingclient.api.PurchasesUpdatedListener {
    private lateinit var billingClient: BillingClient
    private var pendingPurchaseCall: PluginCall? = null

    override fun load() {
        billingClient = BillingClient.newBuilder(context)
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
    }

    private fun withBillingClient(call: PluginCall, action: () -> Unit) {
        if (billingClient.isReady) {
            action()
            return
        }
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) action()
                else call.reject("Play Billing unavailable: ${result.debugMessage}")
            }
            override fun onBillingServiceDisconnected() = Unit
        })
    }

    @PluginMethod
    fun getProducts(call: PluginCall) {
        val ids = call.getArray("productIds") ?: JSArray()
        val products = mutableListOf<QueryProductDetailsParams.Product>()
        for (index in 0 until ids.length()) {
            val id = ids.optString(index)
            if (id.isNotBlank()) {
                products.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build())
            }
        }
        withBillingClient(call) {
            billingClient.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(products).build()
            ) { result, details ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    call.reject("Could not load Play products: ${result.debugMessage}")
                    return@queryProductDetailsAsync
                }
                val list = JSArray()
                details.productDetailsList.forEach { item ->
                    list.put(JSObject().apply {
                        put("productId", item.productId)
                        put("name", item.name)
                        put("description", item.description)
                        put("formattedPrice", item.oneTimePurchaseOfferDetails?.formattedPrice ?: "")
                    })
                }
                call.resolve(JSObject().apply { put("products", list) })
            }
        }
    }

    @PluginMethod
    fun purchase(call: PluginCall) {
        val productId = call.getString("productId")
        if (productId.isNullOrBlank()) {
            call.reject("productId required")
            return
        }
        withBillingClient(call) {
            val product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
            billingClient.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build()
            ) { result, details ->
                val item = details.productDetailsList.firstOrNull()
                if (result.responseCode != BillingClient.BillingResponseCode.OK || item == null) {
                    call.reject("Play product unavailable")
                    return@queryProductDetailsAsync
                }
                pendingPurchaseCall = call
                val params = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(listOf(
                        BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(item).build()
                    )).build()
                val launch = billingClient.launchBillingFlow(activity, params)
                if (launch.responseCode != BillingClient.BillingResponseCode.OK) {
                    pendingPurchaseCall = null
                    call.reject("Could not open Play checkout: ${launch.debugMessage}")
                }
            }
        }
    }

    @PluginMethod
    fun restorePurchases(call: PluginCall) {
        withBillingClient(call) {
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
            ) { result, purchases ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    call.reject("Could not restore purchases")
                    return@queryPurchasesAsync
                }
                val list = JSArray()
                purchases.filter { it.purchaseState == com.android.billingclient.api.Purchase.PurchaseState.PURCHASED }
                    .forEach { purchase ->
                        purchase.products.forEach { productId -> list.put(purchaseJson(productId, purchase.purchaseToken, purchase.orderId)) }
                    }
                call.resolve(JSObject().apply { put("purchases", list) })
            }
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<com.android.billingclient.api.Purchase>?) {
        val call = pendingPurchaseCall ?: return
        pendingPurchaseCall = null
        if (result.responseCode == BillingClient.BillingResponseCode.USER_CANCELED) {
            call.reject("purchase_cancelled", "PURCHASE_CANCELLED")
            return
        }
        val purchase = purchases?.firstOrNull { it.purchaseState == com.android.billingclient.api.Purchase.PurchaseState.PURCHASED }
        val productId = purchase?.products?.firstOrNull()
        if (result.responseCode != BillingClient.BillingResponseCode.OK || purchase == null || productId == null) {
            call.reject("Purchase was not completed: ${result.debugMessage}")
            return
        }
        call.resolve(purchaseJson(productId, purchase.purchaseToken, purchase.orderId))
    }

    private fun purchaseJson(productId: String, token: String, orderId: String?): JSObject = JSObject().apply {
        put("productId", productId)
        put("purchaseToken", token)
        put("orderId", orderId ?: "")
    }

    override fun handleOnDestroy() {
        pendingPurchaseCall?.reject("Purchase interrupted")
        pendingPurchaseCall = null
        if (::billingClient.isInitialized) billingClient.endConnection()
        super.handleOnDestroy()
    }
}