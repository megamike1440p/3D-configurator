<?php
/**
 * Plugin Name: CurrentLuxury 3D Configurator
 * Description: Model-Viewer based 3D product configurator with Elementor, WooCommerce integration, snapshots, and an admin GUI builder.
 * Version: 1.1.1
 * Author: CurrentLuxury
 */

if (!defined('ABSPATH'))
    exit;

define('CLC_CFG_PATH', plugin_dir_path(__FILE__));
define('CLC_CFG_URL', plugin_dir_url(__FILE__));

/**
 * Filter to add type="module" attribute to model-viewer script tags.
 */
function clc_cfg_add_module_attribute($tag, $handle, $src)
{
    // Check for the handles used to register model-viewer
    if ('clc-model-viewer' === $handle || 'clc-model-viewer-admin' === $handle) {
        // Return the script tag with the necessary type="module" attribute
        // Ensure the ID is correctly set for the script to be recognized later by jQuery/JS
        return '<script type="module" src="' . esc_url($src) . '" id="' . $handle . '-js"></script>' . "\n";
    }

    return $tag;
}
add_filter('script_loader_tag', 'clc_cfg_add_module_attribute', 10, 3);


/**
 * Frontend assets
 */
function clc_cfg_enqueue_frontend_assets()
{
    // model-viewer
    wp_enqueue_script(
        'clc-model-viewer',
        'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js',
        [],
        null,
        true
    );

    // configurator engine
    wp_enqueue_script(
        'clc-configurator-js',
        CLC_CFG_URL . 'assets/js/configurator.js',
        ['clc-model-viewer'],
        '1.1.1',
        true
    );

    // frontend styles
    wp_enqueue_style(
        'clc-configurator-css',
        CLC_CFG_URL . 'assets/css/configurator.css',
        [],
        '1.1.1'
    );
}
add_action('wp_enqueue_scripts', 'clc_cfg_enqueue_frontend_assets');

/**
 * Admin assets (builder UI)
 */
function clc_cfg_enqueue_admin_assets($hook)
{
    global $post;

    if ($hook === 'post-new.php' || $hook === 'post.php') {
        if (isset($post->post_type) && $post->post_type === 'clc_configurator') {
            // admin styles
            wp_enqueue_style(
                'clc-configurator-admin-css',
                CLC_CFG_URL . 'assets/css/admin-configurator.css',
                [],
                '1.1.1'
            );

            // model-viewer for material scan/preview
            wp_enqueue_script(
                'clc-model-viewer-admin',
                'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js',
                [],
                null,
                true
            );

            wp_enqueue_script(
                'clc-admin-material-scanner',
                CLC_CFG_URL . 'assets/js/admin-material-scanner.js',
                ['jquery', 'clc-model-viewer-admin'],
                '1.1.1',
                true
            );

            wp_enqueue_script(
                'clc-configurator-admin-js',
                CLC_CFG_URL . 'assets/js/admin-configurator.js',
                ['jquery', 'clc-admin-material-scanner'],
                '1.1.1',
                true
            );

        }
    }
}
add_action('admin_enqueue_scripts', 'clc_cfg_enqueue_admin_assets');

/**
 * Register Configurator CPT
 */
function clc_cfg_register_cpt()
{
    $labels = [
        'name' => 'Configurators',
        'singular_name' => 'Configurator',
        'add_new_item' => 'Add New Configurator',
        'edit_item' => 'Edit Configurator',
    ];

    register_post_type('clc_configurator', [
        'labels' => $labels,
        'public' => false,
        'show_ui' => true,
        'show_in_menu' => true,
        'supports' => ['title'],
        'menu_icon' => 'dashicons-art',
    ]);
}
add_action('init', 'clc_cfg_register_cpt');

/**
 * Meta box for configurator settings
 */
function clc_cfg_add_meta_boxes()
{
    add_meta_box(
        'clc_configurator_meta',
        'Configurator Settings',
        'clc_cfg_render_meta_box',
        'clc_configurator',
        'normal',
        'high'
    );
}
add_action('add_meta_boxes', 'clc_cfg_add_meta_boxes');

function clc_cfg_render_meta_box($post)
{
    wp_nonce_field('clc_configurator_save', 'clc_configurator_nonce');

    $model_url = get_post_meta($post->ID, '_clc_model_url', true);
    $config_json = get_post_meta($post->ID, '_clc_config_json', true);
    $base_price = get_post_meta($post->ID, '_clc_base_price', true);
    ?>

    <div class="clc-configurator-meta-box-content">
        <div class="clc-builder-column">

            <p>
                <label for="clc_model_url"><strong>Model (.glb) URL</strong></label><br>
                <input type="text" id="clc_model_url" name="clc_model_url" value="<?php echo esc_attr($model_url); ?>"
                    style="width:100%;" placeholder="https://.../model.glb" />
            </p>

            <p>
                <button type="button" class="button" id="clc-scan-materials">Scan Model for Materials</button>
            </p>
            <div id="clc-materials-list">
                <em>Click “Scan Model for Materials” after entering a valid GLB URL to see all material names in the
                    model.</em>
            </div>

            <p style="margin-top:15px;">
                <label for="clc_base_price"><strong>Base Price (numeric)</strong></label><br>
                <input type="number" step="0.01" id="clc_base_price" name="clc_base_price"
                    value="<?php echo esc_attr($base_price); ?>" />
            </p>

            <hr>

            <p><strong>Configurator Builder</strong></p>
            <p>
                Use the builder UI below to add categories and options.
                This will generate the JSON configuration used on the frontend.
            </p>

            <div id="clc-builder-root" data-base-price="<?php echo esc_attr($base_price); ?>">
                <p>Loading builder...</p>
            </div>

            <textarea id="clc_config_json" name="clc_config_json" rows="10" style="width:100%; display:none;"><?php
            echo esc_textarea($config_json);
            ?></textarea>

            <p style="margin-top:10px;">
                <em>Shortcode:</em>
                <code>[cl_configurator id="<?php echo esc_attr($post->ID); ?>"]</code>
            </p>
        </div>
        <div class="clc-viewer-column">
            <p style="margin-top: 0;"><strong>3D Model Preview</strong></p>
            <div id="clc-admin-viewer-wrap">
                <model-viewer id="clc-admin-model-viewer" src="<?php echo esc_url($model_url); ?>" camera-controls
                    auto-rotate disable-zoom interaction-prompt="none" environment-image="neutral" shadow-intensity="1"
                    enable-for-material-picker style="width: 100%; height: 100%;">
                </model-viewer>

            </div>
        </div>
    </div><?php
}
function clc_cfg_save_meta($post_id)
{
    if (!isset($_POST['clc_configurator_nonce']))
        return;
    if (!wp_verify_nonce($_POST['clc_configurator_nonce'], 'clc_configurator_save'))
        return;
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE)
        return;
    if (get_post_type($post_id) !== 'clc_configurator')
        return;

    if (isset($_POST['clc_model_url'])) {
        update_post_meta($post_id, '_clc_model_url', esc_url_raw($_POST['clc_model_url']));
    }

    if (isset($_POST['clc_base_price'])) {
        update_post_meta($post_id, '_clc_base_price', floatval($_POST['clc_base_price']));
    }

    if (isset($_POST['clc_config_json'])) {
        update_post_meta($post_id, '_clc_config_json', wp_kses_post(wp_unslash($_POST['clc_config_json'])));
    }
}
add_action('save_post_clc_configurator', 'clc_cfg_save_meta');

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

/**
 * Elementor widget
 */
function clc_cfg_register_elementor_widget($widgets_manager)
{
    if (!class_exists('\Elementor\Widget_Base'))
        return;

    class CLC_Elementor_Configurator_Widget extends \Elementor\Widget_Base
    {
        public function get_name()
        {
            return 'clc_configurator_widget';
        }

        public function get_title()
        {
            return 'CL 3D Configurator';
        }

        public function get_icon()
        {
            return 'eicon-gallery-grid';
        }

        public function get_categories()
        {
            return ['general'];
        }

        protected function _register_controls()
        {
            $this->start_controls_section(
                'section_config',
                ['label' => 'Configurator']
            );

            $configs = get_posts([
                'post_type' => 'clc_configurator',
                'posts_per_page' => -1,
                'post_status' => 'publish',
            ]);

            $options = ['' => 'Select a configurator'];
            foreach ($configs as $c) {
                $options[$c->ID] = $c->post_title;
            }

            $this->add_control(
                'configurator_id',
                [
                    'label' => 'Configurator',
                    'type' => \Elementor\Controls_Manager::SELECT,
                    'options' => $options,
                ]
            );

            $this->add_control(
                'show_price',
                [
                    'label' => 'Show Price',
                    'type' => \Elementor\Controls_Manager::SWITCHER,
                    'default' => 'yes',
                ]
            );

            $this->add_control(
                'show_cart',
                [
                    'label' => 'Show Add to Cart Button',
                    'type' => \Elementor\Controls_Manager::SWITCHER,
                    'default' => 'yes',
                ]
            );

            $this->add_control(
                'show_snapshot_button',
                [
                    'label' => 'Show Snapshot Button',
                    'type' => \Elementor\Controls_Manager::SWITCHER,
                    'default' => 'yes',
                ]
            );

            $this->end_controls_section();
        }

        protected function render()
        {
            $settings = $this->get_settings_for_display();
            $id = !empty($settings['configurator_id']) ? intval($settings['configurator_id']) : 0;
            if (!$id) {
                echo '<p>Please select a configurator.</p>';
                return;
            }

            $show_price = $settings['show_price'] === 'yes' ? 'yes' : 'no';
            $show_cart = $settings['show_cart'] === 'yes' ? 'yes' : 'no';
            $show_snapshot = $settings['show_snapshot_button'] === 'yes' ? 'yes' : 'no';

            echo do_shortcode(
                '[cl_configurator id="' . $id . '" show_price="' . $show_price . '" show_cart="' . $show_cart . '" show_snapshot_button="' . $show_snapshot . '"]'
            );
        }
    }

    $widgets_manager->register(new \CLC_Elementor_Configurator_Widget());
}
add_action('elementor/widgets/register', 'clc_cfg_register_elementor_widget');

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