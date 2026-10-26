import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:url_launcher/url_launcher.dart';

const Color _navy = Color(0xFF030814);
const Color _panel = Color(0xFF071326);
const Color _cyan = Color(0xFF00E5FF);
const Color _pink = Color(0xFFFF28CF);
const Color _green = Color(0xFF39FF9C);
const String _agendaUrl = 'https://futbol-libre.cam/';

class WebAgendaScreen extends StatefulWidget {
  const WebAgendaScreen({super.key});

  @override
  State<WebAgendaScreen> createState() => _WebAgendaScreenState();
}

class _WebAgendaScreenState extends State<WebAgendaScreen> {
  InAppWebViewController? _controller;
  double _progress = 0;
  String? _error;
  bool _loading = true;

  static const Set<String> _allowedHosts = {
    'futbol-libre.cam',
    'www.futbol-libre.cam',
  };

  bool _allowed(Uri uri) =>
      uri.scheme == 'https' && _allowedHosts.contains(uri.host.toLowerCase());

  Future<void> _back() async {
    final c = _controller;
    if (c != null && await c.canGoBack()) {
      await c.goBack();
    } else if (mounted) {
      Navigator.of(context).maybePop();
    }
  }

  Future<void> _reload() async {
    setState(() {
      _error = null;
      _loading = true;
      _progress = 0;
    });
    await _controller?.loadUrl(urlRequest: URLRequest(url: WebUri(_agendaUrl)));
  }

  Future<NavigationActionPolicy> _navigation(
    InAppWebViewController controller,
    NavigationAction action,
  ) async {
    final webUrl = action.request.url;
    if (webUrl == null) return NavigationActionPolicy.CANCEL;

    final uri = Uri.tryParse(webUrl.toString());
    if (uri == null) return NavigationActionPolicy.CANCEL;
    if (_allowed(uri)) return NavigationActionPolicy.ALLOW;

    if (uri.scheme == 'https' || uri.scheme == 'http') {
      try {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      } catch (_) {}
    }
    return NavigationActionPolicy.CANCEL;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (!didPop) await _back();
      },
      child: Scaffold(
        backgroundColor: _navy,
        appBar: AppBar(
          backgroundColor: _panel,
          leading: IconButton(
            onPressed: _back,
            icon: const Icon(Icons.arrow_back, color: _cyan),
          ),
          title: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'DEPORTE TOTAL 360°',
                style: TextStyle(
                  color: _cyan,
                  fontWeight: FontWeight.w900,
                  fontSize: 14,
                ),
              ),
              Text(
                'AGENDA DEPORTIVA',
                style: TextStyle(color: Colors.white70, fontSize: 10),
              ),
            ],
          ),
          actions: [
            IconButton(
              tooltip: 'Recargar agenda',
              onPressed: _reload,
              icon: const Icon(Icons.refresh, color: _green),
            ),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(2),
            child: LinearProgressIndicator(
              value: _progress >= 1 ? null : _progress,
              backgroundColor: _panel,
              valueColor: const AlwaysStoppedAnimation<Color>(_pink),
            ),
          ),
        ),
        body: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              color: const Color(0xFF091A31),
              child: const Row(
                children: [
                  Icon(Icons.sports_soccer, color: _cyan, size: 20),
                  SizedBox(width: 9),
                  Expanded(
                    child: Text(
                      'AGENDA DE PARTIDOS',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  Icon(Icons.sports_basketball, color: _pink, size: 19),
                ],
              ),
            ),
            Expanded(
              child: Stack(
                children: [
                  InAppWebView(
                    initialUrlRequest: URLRequest(url: WebUri(_agendaUrl)),
                    initialSettings: InAppWebViewSettings(
                      javaScriptEnabled: true,
                      domStorageEnabled: true,
                      supportMultipleWindows: false,
                      javaScriptCanOpenWindowsAutomatically: false,
                      useShouldOverrideUrlLoading: true,
                      mediaPlaybackRequiresUserGesture: true,
                      allowsInlineMediaPlayback: true,
                      thirdPartyCookiesEnabled: true,
                    ),
                    onWebViewCreated: (controller) => _controller = controller,
                    onLoadStart: (controller, url) {
                      if (!mounted) return;
                      setState(() {
                        _loading = true;
                        _error = null;
                        _progress = 0;
                      });
                    },
                    onProgressChanged: (controller, progress) {
                      if (!mounted) return;
                      setState(() {
                        _progress = progress / 100;
                        _loading = progress < 100;
                      });
                    },
                    onLoadStop: (controller, url) {
                      if (!mounted) return;
                      setState(() {
                        _loading = false;
                        _progress = 1;
                      });
                    },
                    onReceivedError: (controller, request, error) {
                      if (request.isForMainFrame != true || !mounted) return;
                      setState(() {
                        _loading = false;
                        _error =
                            'No se pudo cargar la página. Comprueba tu conexión e inténtalo de nuevo.';
                      });
                    },
                    shouldOverrideUrlLoading: _navigation,
                    onCreateWindow: (controller, action) async => false,
                  ),
                  if (_loading && _error == null)
                    const Positioned(
                      top: 0,
                      left: 0,
                      right: 0,
                      child: LinearProgressIndicator(
                        minHeight: 2,
                        backgroundColor: Colors.transparent,
                        valueColor: AlwaysStoppedAnimation<Color>(_pink),
                      ),
                    ),
                  if (_error != null)
                    Positioned.fill(
                      child: Container(
                        color: _navy,
                        padding: const EdgeInsets.all(24),
                        child: Center(
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.wifi_off, size: 54, color: _pink),
                              const SizedBox(height: 16),
                              const Text(
                                'AGENDA NO DISPONIBLE',
                                style: TextStyle(
                                  color: _cyan,
                                  fontWeight: FontWeight.w900,
                                  fontSize: 18,
                                ),
                              ),
                              const SizedBox(height: 10),
                              Text(
                                _error!,
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: Colors.white70),
                              ),
                              const SizedBox(height: 20),
                              FilledButton.icon(
                                onPressed: _reload,
                                icon: const Icon(Icons.refresh),
                                label: const Text('VOLVER A INTENTAR'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}