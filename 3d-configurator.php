<?php
/**
 * Plugin Name: 3D Configurator
 * Description: Model-Viewer based 3D product configurator with Elementor, 
 * WooCommerce integration, snapshots, and an admin GUI builder. 
 * A state-driven configurator where UI, 3D, and price all react to the same source of truth. 
 * Version: 1.1.1
 * Author: megamike1080 & evilliza
 * entry point for plug in to load
 */

if (!defined('ABSPATH'))
    exit;

define('CONFIGURATOR_PATH', plugin_dir_path(__FILE__));
define('CONFIGURATOR_URL', plugin_dir_url(__FILE__));
define('CONFIGURATOR_VERSION', '1.1.1');
define('CONFIGURATOR_POST_TYPE', '3d-configurator');

require_once CONFIGURATOR_PATH . 'includes/class-assets.php';
require_once CONFIGURATOR_PATH . 'includes/class-cpt.php';
require_once CONFIGURATOR_PATH . 'includes/class-meta-box.php';
require_once CONFIGURATOR_PATH . 'includes/class-shortcode.php';
require_once CONFIGURATOR_PATH . 'includes/class-elementor.php';
require_once CONFIGURATOR_PATH . 'includes/class-woocommerce.php';

function configurator_init()
{
    CONFIGURATOR_Assets::init();
    CONFIGURATOR_CPT::init();
    CONFIGURATOR_Meta_Box::init();
    CONFIGURATOR_Shortcode::init();
    CONFIGURATOR_Elementor::init();
    CONFIGURATOR_WooCommerce::init();
}

add_action('plugins_loaded', 'configurator_init');
