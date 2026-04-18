<?php
/**
 * Handles WooCommerce integration for the configurator.
 */
class CONFIGURATOR_WooCommerce
{
    private const MAX_PRICE_DELTA = 100000;

    public static function init()
    {
        add_filter('woocommerce_add_cart_item_data', [self::class, 'add_cart_item_data'], 10, 3);
        add_action('woocommerce_before_calculate_totals', [self::class, 'apply_price_delta'], 10);
        add_filter('woocommerce_get_item_data', [self::class, 'display_item_data'], 10, 2);
        add_action('woocommerce_checkout_create_order_line_item', [self::class, 'save_order_meta'], 10, 4);
    }

    public static function add_cart_item_data($cart_item_data, $product_id, $variation_id)
    {
        $nonce = isset($_POST['configurator_nonce'])
            ? sanitize_text_field(wp_unslash($_POST['configurator_nonce']))
            : '';

        if (
            (isset($_POST['config_data']) || isset($_POST['price_delta']) || isset($_POST['snapshot']))
            && !wp_verify_nonce($nonce, 'configurator_add_to_cart')
        ) {
            return $cart_item_data;
        }

        if (isset($_POST['config_data'])) {
            $config_data = wp_unslash($_POST['config_data']);
            $decoded = json_decode($config_data, true);
            if (json_last_error() === JSON_ERROR_NONE) {
                $cart_item_data['configurator_data'] = wp_json_encode($decoded);
                $cart_item_data['configurator_price_delta'] = self::compute_price_delta_from_payload($decoded);
            }
        }

        if (
            !isset($cart_item_data['configurator_price_delta']) &&
            isset($_POST['price_delta'])
        ) {
            $cart_item_data['configurator_price_delta'] = self::sanitize_price_delta($_POST['price_delta']);
        }

        if (isset($_POST['snapshot'])) {
            $cart_item_data['configurator_snapshot'] = esc_url_raw(wp_unslash($_POST['snapshot']));
        }

        return $cart_item_data;
    }

    public static function apply_price_delta($cart)
    {
        if (is_admin() && !defined('DOING_AJAX')) {
            return;
        }

        foreach ($cart->get_cart() as $cart_item_key => $cart_item) {

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
                $cart->cart_contents[$cart_item_key]['configurator_price_applied'] = true;
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

    private static function sanitize_price_delta($value)
    {
        $delta = floatval(wp_unslash($value));
        return max(-self::MAX_PRICE_DELTA, min(self::MAX_PRICE_DELTA, $delta));
    }

    private static function compute_price_delta_from_payload($payload)
    {
        $config_id = isset($payload['config_id']) ? intval($payload['config_id']) : 0;
        $selected_ids = isset($payload['selected_node_ids']) && is_array($payload['selected_node_ids'])
            ? array_map('strval', $payload['selected_node_ids'])
            : [];

        if (!$config_id || !$selected_ids) {
            return 0;
        }

        $config_json = get_post_meta($config_id, '_configurator_config_json', true);
        if (!$config_json) {
            return 0;
        }

        $config = json_decode($config_json, true);
        if (!is_array($config) || !isset($config['root']) || !is_array($config['root'])) {
            return 0;
        }

        $selected_lookup = array_fill_keys($selected_ids, true);
        return self::walk_price_effects($config['root'], $selected_lookup, true);
    }

    private static function walk_price_effects($node, $selected_lookup, $ancestors_satisfied)
    {
        if (!is_array($node)) {
            return 0;
        }

        $node_id = isset($node['id']) ? strval($node['id']) : '';
        $is_root = ($node_id === 'root');
        $is_selectable = self::is_selectable_node($node);
        $is_selected = $is_root ? true : isset($selected_lookup[$node_id]);
        $is_active = $is_root ? true : ($is_selected && $ancestors_satisfied);

        $price_delta = 0;
        if ($is_active && !empty($node['effects']) && is_array($node['effects'])) {
            foreach ($node['effects'] as $effect) {
                if (is_array($effect) && ($effect['type'] ?? '') === 'price') {
                    $price_delta += self::sanitize_price_delta($effect['delta'] ?? 0);
                }
            }
        }

        $next_ancestors_satisfied = $ancestors_satisfied;
        if (!$is_root && $is_selectable) {
            $next_ancestors_satisfied = $ancestors_satisfied && $is_selected;
        }

        if (!empty($node['children']) && is_array($node['children'])) {
            foreach ($node['children'] as $child) {
                $price_delta += self::walk_price_effects($child, $selected_lookup, $next_ancestors_satisfied);
            }
        }

        return $price_delta;
    }

    private static function is_selectable_node($node)
    {
        return !is_array($node) || !array_key_exists('selectable', $node) || $node['selectable'] !== false;
    }
}
