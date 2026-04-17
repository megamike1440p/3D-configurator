<?php
/**
 * Handles WooCommerce integration for the configurator.
 */
class CONFIGURATOR_WooCommerce
{
    public static function init()
    {
        add_filter('woocommerce_add_cart_item_data', [self::class, 'add_cart_item_data'], 10, 3);
        add_action('woocommerce_before_calculate_totals', [self::class, 'apply_price_delta'], 10);
        add_filter('woocommerce_get_item_data', [self::class, 'display_item_data'], 10, 2);
        add_action('woocommerce_checkout_create_order_line_item', [self::class, 'save_order_meta'], 10, 4);
    }

    public static function add_cart_item_data($cart_item_data, $product_id, $variation_id)
    {
        if (isset($_POST['config_data'])) {
            $cart_item_data['configurator_data'] = wp_unslash($_POST['config_data']);
        }

        if (isset($_POST['price_delta'])) {
            $cart_item_data['configurator_price_delta'] = floatval($_POST['price_delta']);
        }

        if (isset($_POST['snapshot'])) {
            $cart_item_data['configurator_snapshot'] = wp_unslash($_POST['snapshot']);
        }

        return $cart_item_data;
    }

    public static function apply_price_delta($cart)
    {
        if (is_admin() && !defined('DOING_AJAX')) {
            return;
        }

        foreach ($cart->get_cart() as $cart_item) {

            if (isset($cart_item['configurator_price_delta'])) {

                // Prevent stacking
                if (isset($cart_item['configurator_price_applied'])) {
                    continue;
                }

                $delta = floatval($cart_item['configurator_price_delta']);

                $product = $cart_item['data'];
                $base_price = $product->get_price();

                $product->set_price($base_price + $delta);

                // mark as applied
                $cart_item['configurator_price_applied'] = true;
            }
        }
    }

    public static function display_item_data($item_data, $cart_item)
    {
        if (isset($cart_item['configurator_data'])) {

            $config = json_decode($cart_item['configurator_data'], true);

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

    public static function save_order_meta($item, $cart_item_key, $values, $order)
    {
        if (isset($values['configurator_data'])) {
            $item->add_meta_data('_configurator_data', $values['configurator_data'], true);
        }

        if (isset($values['configurator_snapshot'])) {
            $item->add_meta_data('_configurator_snapshot', $values['configurator_snapshot'], true);
        }
    }
}