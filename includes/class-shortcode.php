<?php
/**
 * Shortcode: [cl_configurator id="123" product_id="456"]
 */
function clc_cfg_shortcode($atts)
{
    $atts = shortcode_atts([
        'id' => 0,
        'product_id' => 0,
        'show_price' => 'yes',
        'show_cart' => 'yes',
        'show_snapshot_button' => 'yes',
    ], $atts, 'cl_configurator');

    $config_id = intval($atts['id']);
    if (!$config_id)
        return '';

    $model_url = get_post_meta($config_id, '_clc_model_url', true);
    $config_json = get_post_meta($config_id, '_clc_config_json', true);
    $base_price = get_post_meta($config_id, '_clc_base_price', true);

    if (!$model_url || !$config_json) {
        return '<p>Configurator not configured yet.</p>';
    }

    $product_id = intval($atts['product_id']);
    if (!$product_id && function_exists('is_product') && is_product()) {
        $product_id = get_the_ID();
    }

    $wrapper_id = 'clc-config-' . $config_id;

    ob_start();
    ?>
        <div id="<?php echo esc_attr($wrapper_id); ?>" class="clc-configurator-root" data-clc-configurator="1"
            data-config-id="<?php echo esc_attr($config_id); ?>" data-model="<?php echo esc_url($model_url); ?>"
            data-config="<?php echo esc_attr($config_json); ?>" data-base-price="<?php echo esc_attr($base_price); ?>"
            data-product-id="<?php echo esc_attr($product_id); ?>"
            data-show-price="<?php echo esc_attr($atts['show_price']); ?>"
            data-show-cart="<?php echo esc_attr($atts['show_cart']); ?>"
            data-show-snapshot="<?php echo esc_attr($atts['show_snapshot_button']); ?>">
        </div>
        <?php
        return ob_get_clean();
}
add_shortcode('cl_configurator', 'clc_cfg_shortcode');
