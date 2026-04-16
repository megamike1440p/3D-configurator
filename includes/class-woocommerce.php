<?php
/**
 * WooCommerce integration
 */
function clc_cfg_wc_add_cart_item_data($cart_item_data, $product_id, $variation_id)
{
    if (isset($_POST['clc_config_data'])) {
        $cart_item_data['clc_config_data'] = wp_unslash($_POST['clc_config_data']);
    }
    if (isset($_POST['clc_price_delta'])) {
        $cart_item_data['clc_price_delta'] = floatval($_POST['clc_price_delta']);
    }
    if (isset($_POST['clc_snapshot'])) {
        $cart_item_data['clc_snapshot'] = wp_unslash($_POST['clc_snapshot']);
    }
    return $cart_item_data;
}
add_filter('woocommerce_add_cart_item_data', 'clc_cfg_wc_add_cart_item_data', 10, 3);

function clc_cfg_wc_before_calculate_totals($cart)
{
    if (is_admin() && !defined('DOING_AJAX'))
        return;

    foreach ($cart->get_cart() as $cart_item_key => $cart_item) {
        if (isset($cart_item['clc_price_delta'])) {
            $delta = floatval($cart_item['clc_price_delta']);
            $price = $cart_item['data']->get_price();
            $cart_item['data']->set_price($price + $delta);
        }
    }
}
add_action('woocommerce_before_calculate_totals', 'clc_cfg_wc_before_calculate_totals', 10, 1);

function clc_cfg_wc_get_item_data($item_data, $cart_item)
{
    if (isset($cart_item['clc_config_data'])) {
        $config = json_decode($cart_item['clc_config_data'], true);
        if (is_array($config) && isset($config['selections'])) {
            foreach ($config['selections'] as $cat => $label) {
                $item_data[] = [
                    'name' => ucfirst($cat),
                    'value' => $label,
                ];
            }
        }
    }
    return $item_data;
}
add_filter('woocommerce_get_item_data', 'clc_cfg_wc_get_item_data', 10, 2);

function clc_cfg_wc_checkout_create_order_line_item($item, $cart_item_key, $values, $order)
{
    if (isset($values['clc_config_data'])) {
        $item->add_meta_data('_clc_config_data', $values['clc_config_data'], true);
    }
    if (isset($values['clc_snapshot'])) {
        $item->add_meta_data('_clc_snapshot', $values['clc_snapshot'], true);
    }
}
add_action('woocommerce_checkout_create_order_line_item', 'clc_cfg_wc_checkout_create_order_line_item', 10, 4);