import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';
import 'web_agenda_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const DeporteTotal360App());
}

const Color bg = Color(0xFF030814);
const Color panel = Color(0xFF071326);
const Color cyan = Color(0xFF00E5FF);
const Color pink = Color(0xFFFF28CF);
const Color green = Color(0xFF39FF9C);
const Color yellow = Color(0xFFFFD600);
const Color blue = Color(0xFF087BFF);
const Color muted = Color(0xFFA9BDD6);

const String streamUrl =
    'https://lbgo.bozztv.com/ssh101/ssh101/deportetotal360/playlist.m3u8';
const String whatsappUrl =
    'https://wa.me/5927214741?text=Hola%2C%20contacto%20con%20DEPORTE%20TOTAL%20360';
const String telegramUrl = 'https://t.me/deportetotal360';

Future<void> openUrl(String value) async {
  final uri = Uri.tryParse(value);
  if (uri == null || !uri.hasScheme) return;
  try {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {}
}

class DeporteTotal360App extends StatelessWidget {
  const DeporteTotal360App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DEPORTE TOTAL 360°',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: bg,
        colorScheme: ColorScheme.fromSeed(
          seedColor: cyan,
          brightness: Brightness.dark,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: panel,
          foregroundColor: Colors.white,
        ),
      ),
      home: const HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;

  void _open(Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  void _selectTab(int index) {
    setState(() => _tab = index);
    if (index == 1 || index == 3) {
      _open(const WebAgendaScreen());
    } else if (index == 2) {
      _open(const LiveScreen());
    } else if (index == 4) {
      _open(const SettingsScreen());
    }
    if (index != 0) setState(() => _tab = 0);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 14,
        title: const Text(
          'DEPORTE TOTAL 360°',
          style: TextStyle(
            color: cyan,
            fontWeight: FontWeight.w900,
            fontSize: 16,
            letterSpacing: .4,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Telegram',
            onPressed: () => openUrl(telegramUrl),
            icon: const Icon(Icons.send_rounded, color: cyan),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Stack(
        children: [
          const Positioned.fill(child: SportsBackdrop()),
          ListView(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 24),
            children: [
              const BrandHero(),
              const SizedBox(height: 22),
              const SectionTitle(
                title: 'TODOS LOS DEPORTES EN UN SOLO LUGAR',
                color: cyan,
              ),
              const SizedBox(height: 12),
              const SportsRow(),
              const SizedBox(height: 16),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 11,
                mainAxisSpacing: 11,
                childAspectRatio: 1.15,
                children: [
                  FeatureTile(
                    icon: Icons.live_tv_rounded,
                    title: 'TRANSMISIONES',
                    subtitle: 'EN VIVO',
                    color: pink,
                    onTap: () => _open(const LiveScreen()),
                  ),
                  FeatureTile(
                    icon: Icons.calendar_month_rounded,
                    title: 'AGENDA',
                    subtitle: 'DE PARTIDOS',
                    color: green,
                    onTap: () => _open(const WebAgendaScreen()),
                  ),
                  FeatureTile(
                    icon: Icons.send_rounded,
                    title: 'TELEGRAM',
                    subtitle: 'CANAL OFICIAL',
                    color: const Color(0xFF28A8E9),
                    onTap: () => openUrl(telegramUrl),
                  ),
                  FeatureTile(
                    icon: Icons.chat_rounded,
                    title: 'CONTACTAR',
                    subtitle: 'WHATSAPP',
                    color: green,
                    onTap: () => openUrl(whatsappUrl),
                  ),
                  FeatureTile(
                    icon: Icons.favorite_rounded,
                    title: 'DONACIONES',
                    subtitle: 'APOYA EL PROYECTO',
                    color: yellow,
                    onTap: () => _open(const DonationsScreen()),
                  ),
                  FeatureTile(
                    icon: Icons.sports_soccer_rounded,
                    title: 'MÁS DEPORTES',
                    subtitle: 'DESCUBRE LA AGENDA',
                    color: blue,
                    onTap: () => _open(const WebAgendaScreen()),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              const SportsBanner(),
              const SizedBox(height: 18),
              const Text(
                'FÚTBOL  •  BÁSQUET  •  TENIS  •  BÉISBOL  •  VOLEIBOL',
                textAlign: TextAlign.center,
                style: TextStyle(color: muted, fontSize: 10, letterSpacing: .4),
              ),
              const SizedBox(height: 12),
              const Center(
                child: Text(
                  'DEPORTE TOTAL 360° · TU PASIÓN, EN TODAS PARTES',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white38, fontSize: 10),
                ),
              ),
            ],
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        backgroundColor: panel,
        indicatorColor: cyan.withValues(alpha: .16),
        selectedIndex: _tab,
        onDestinationSelected: _selectTab,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home_rounded, color: cyan),
            label: 'Inicio',
          ),
          NavigationDestination(
            icon: Icon(Icons.sports_soccer_rounded),
            label: 'Fútbol',
          ),
          NavigationDestination(
            icon: Icon(Icons.live_tv_rounded),
            label: 'En vivo',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_month_rounded),
            label: 'Agenda',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_rounded),
            label: 'Ajustes',
          ),
        ],
      ),
    );
  }
}

class BrandHero extends StatelessWidget {
  const BrandHero({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          colors: [Color(0xFF071B46), Color(0xFF160B3C), Color(0xFF031326)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: cyan.withValues(alpha: .9)),
        boxShadow: [
          BoxShadow(color: cyan.withValues(alpha: .12), blurRadius: 22),
          BoxShadow(color: pink.withValues(alpha: .08), blurRadius: 28),
        ],
      ),
      child: Column(
        children: [
          Container(
            height: 235,
            width: double.infinity,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: const LinearGradient(
                colors: [Color(0xFF0A234B), Color(0xFF1A0F44), Color(0xFF0A1A31)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              border: Border.all(color: cyan.withValues(alpha: .7)),
            ),
            child: const Center(
              child: Icon(
                Icons.emoji_events_rounded,
                size: 90,
                color: yellow,
                shadows: [Shadow(color: pink, blurRadius: 18)],
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'TODOS LOS DEPORTES EN UN SOLO LUGAR',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
              fontSize: 13,
              letterSpacing: .4,
            ),
          ),
        ],
      ),
    );
  }
}

class SportsRow extends StatelessWidget {
  const SportsRow({super.key});

  @override
  Widget build(BuildContext context) {
    const sports = [
      (Icons.sports_soccer_rounded, 'FÚTBOL', cyan),
      (Icons.sports_basketball_rounded, 'BÁSQUET', yellow),
      (Icons.sports_tennis_rounded, 'TENIS', green),
      (Icons.sports_baseball_rounded, 'BÉISBOL', pink),
      (Icons.sports_volleyball_rounded, 'VOLEY', blue),
      (Icons.emoji_events_rounded, 'OTROS', Color(0xFFB45CFF)),
    ];
    return Row(
      children: [
        for (final sport in sports)
          Expanded(
            child: Column(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: sport.$3.withValues(alpha: .08),
                    border: Border.all(color: sport.$3.withValues(alpha: .8)),
                    boxShadow: [
                      BoxShadow(color: sport.$3.withValues(alpha: .12), blurRadius: 10),
                    ],
                  ),
                  child: Icon(sport.$1, color: sport.$3, size: 23),
                ),
                const SizedBox(height: 5),
                Text(
                  sport.$2,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 8,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle({super.key, required this.title, required this.color});
  final String title;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 4,
          height: 22,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(4),
            boxShadow: [BoxShadow(color: color, blurRadius: 8)],
          ),
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Text(
            title,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w900,
              letterSpacing: .45,
              fontSize: 12,
            ),
          ),
        ),
      ],
    );
  }
}

class FeatureTile extends StatelessWidget {
  const FeatureTile({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: panel,
      borderRadius: BorderRadius.circular(17),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(17),
            border: Border.all(color: color.withValues(alpha: .9)),
            boxShadow: [
              BoxShadow(color: color.withValues(alpha: .08), blurRadius: 12),
            ],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 34,
                color: color,
                shadows: [Shadow(color: color, blurRadius: 12)],
              ),
              const SizedBox(height: 9),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 11,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: color,
                  fontWeight: FontWeight.w800,
                  fontSize: 9,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SportsBanner extends StatelessWidget {
  const SportsBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: const LinearGradient(
          colors: [Color(0xFF061A3A), Color(0xFF250B40), Color(0xFF062E3C)],
        ),
        border: Border.all(color: pink.withValues(alpha: .8)),
      ),
      child: const Column(
        children: [
          Icon(Icons.emoji_events_rounded, color: yellow, size: 35),
          SizedBox(height: 7),
          Text(
            '¡EL DEPORTE NOS UNE!',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w900,
              color: cyan,
              shadows: [Shadow(color: pink, blurRadius: 12)],
            ),
          ),
          SizedBox(height: 6),
          Text(
            'Fútbol · Baloncesto · Béisbol · Tenis · Voleibol · Y más',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white70, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class SportsBackdrop extends StatelessWidget {
  const SportsBackdrop({super.key});

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Stack(
        children: [
          Positioned(
            top: 100,
            left: -80,
            child: _glow(190, cyan.withValues(alpha: .035)),
          ),
          Positioned(
            top: 470,
            right: -80,
            child: _glow(220, pink.withValues(alpha: .035)),
          ),
          Positioned(
            bottom: 70,
            left: -45,
            child: _glow(150, green.withValues(alpha: .025)),
          ),
        ],
      ),
    );
  }

  Widget _glow(double size, Color color) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
        boxShadow: [BoxShadow(color: color, blurRadius: 70, spreadRadius: 25)],
      ),
    );
  }
}

class LiveScreen extends StatefulWidget {
  const LiveScreen({super.key});

  @override
  State<LiveScreen> createState() => _LiveScreenState();
}

class _LiveScreenState extends State<LiveScreen> {
  VideoPlayerController? _player;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _startPlayer();
  }

  Future<void> _startPlayer() async {
    final old = _player;
    _player = null;
    await old?.dispose();
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    final player = VideoPlayerController.networkUrl(Uri.parse(streamUrl));
    _player = player;

    try {
      await player.initialize();
      if (!mounted || _player != player) {
        await player.dispose();
        return;
      }
      await player.play();
      if (mounted) setState(() => _loading = false);
    } catch (_) {
      if (!mounted || _player != player) return;
      setState(() {
        _loading = false;
        _error = 'La señal no está disponible en este momento.';
      });
    }
  }

  @override
  void dispose() {
    _player?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final p = _player;
    final offline =
        !_loading && (_error != null || p == null || !p.value.isInitialized);

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'TRANSMISIONES EN VIVO',
          style: TextStyle(
            color: cyan,
            fontWeight: FontWeight.w900,
            fontSize: 15,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const SectionTitle(
            title: 'CANAL EN VIVO DE DEPORTE TOTAL 360°',
            color: pink,
          ),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: Container(
                color: Colors.black,
                child: _loading
                    ? const Center(child: CircularProgressIndicator(color: cyan))
                    : offline
                        ? const OfflinePanel()
                        : Stack(
                            alignment: Alignment.center,
                            children: [
                              SizedBox.expand(
                                child: FittedBox(
                                  fit: BoxFit.contain,
                                  child: SizedBox(
                                    width: p.value.size.width,
                                    height: p.value.size.height,
                                    child: VideoPlayer(p),
                                  ),
                                ),
                              ),
                              IconButton.filled(
                                onPressed: () {
                                  setState(() {
                                    p.value.isPlaying ? p.pause() : p.play();
                                  });
                                },
                                iconSize: 38,
                                icon: Icon(
                                  p.value.isPlaying ? Icons.pause : Icons.play_arrow,
                                ),
                              ),
                            ],
                          ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          if (offline) ...[
            Text(
              _error ?? 'La señal está fuera de línea.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: muted),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _startPlayer,
              icon: const Icon(Icons.refresh),
              label: const Text('RECARGAR SEÑAL'),
            ),
          ] else
            const Text(
              'Selecciona reproducir para iniciar la transmisión.',
              textAlign: TextAlign.center,
              style: TextStyle(color: muted),
            ),
          const SizedBox(height: 18),
          FeatureTile(
            icon: Icons.calendar_month_rounded,
            title: 'AGENDA DE PARTIDOS',
            subtitle: 'CONSULTAR PROGRAMACIÓN',
            color: green,
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const WebAgendaScreen()),
            ),
          ),
        ],
      ),
    );
  }
}

class OfflinePanel extends StatelessWidget {
  const OfflinePanel({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF07152E), Color(0xFF240A3C), Color(0xFF031B29)],
        ),
      ),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.sports_soccer_rounded, color: cyan, size: 36),
          SizedBox(height: 8),
          Text(
            'DEPORTE TOTAL 360°',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: cyan,
              fontWeight: FontWeight.w900,
              fontSize: 18,
            ),
          ),
          SizedBox(height: 8),
          Icon(Icons.portable_wifi_off_rounded, color: pink, size: 36),
          SizedBox(height: 8),
          Text('CANAL EN VIVO', style: TextStyle(fontWeight: FontWeight.w900)),
          Text(
            'FUERA DE LÍNEA',
            style: TextStyle(
              color: pink,
              fontWeight: FontWeight.w900,
              fontSize: 18,
            ),
          ),
        ],
      ),
    );
  }
}

class DonationsScreen extends StatelessWidget {
  const DonationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('DONACIONES')),
      body: Padding(
        padding: const EdgeInsets.all(22),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.favorite_rounded, color: pink, size: 76),
            const SizedBox(height: 18),
            const Text(
              'APOYA EL PROYECTO',
              style: TextStyle(
                color: yellow,
                fontSize: 22,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Gracias por apoyar DEPORTE TOTAL 360°. '
              'Contacta con el creador para conocer las opciones de donación.',
              textAlign: TextAlign.center,
              style: TextStyle(color: muted, height: 1.5),
            ),
            const SizedBox(height: 22),
            FilledButton.icon(
              onPressed: () => openUrl(whatsappUrl),
              icon: const Icon(Icons.chat_rounded),
              label: const Text('CONTACTAR POR WHATSAPP'),
            ),
          ],
        ),
      ),
    );
  }
}

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('AJUSTES')),
      body: ListView(
        children: [
          const ListTile(
            leading: Icon(Icons.dark_mode_rounded, color: cyan),
            title: Text('Modo oscuro'),
            subtitle: Text('Interfaz deportiva oscura'),
            trailing: Icon(Icons.check_circle, color: green),
          ),
          const Divider(color: Colors.white12),
          const ListTile(
            leading: Icon(Icons.notifications_active_rounded, color: green),
            title: Text('Notificaciones'),
            subtitle: Text('Las notificaciones requieren configuración adicional.'),
          ),
          const Divider(color: Colors.white12),
          ListTile(
            leading: const Icon(Icons.send_rounded, color: Color(0xFF28A8E9)),
            title: const Text('Canal de Telegram'),
            subtitle: const Text('Enlace oficial del canal'),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => openUrl(telegramUrl),
          ),
          const Divider(color: Colors.white12),
          ListTile(
            leading: const Icon(Icons.support_agent_rounded, color: green),
            title: const Text('Contactar con el creador'),
            onTap: () => openUrl(whatsappUrl),
          ),
          const Divider(color: Colors.white12),
          const ListTile(
            leading: Icon(Icons.info_outline_rounded, color: cyan),
            title: Text('Acerca de'),
            subtitle: Text('DEPORTE TOTAL 360° · Tu pasión, en todas partes.'),
          ),
        ],
      ),
    );
  }
}